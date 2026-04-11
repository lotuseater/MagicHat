import crypto from "node:crypto";
import { WebSocket } from "ws";

function toWebSocketUrl(relayUrl) {
  const parsed = new URL(relayUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/v2/host/connect";
  parsed.search = "";
  return parsed.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RelayClient {
  constructor(options) {
    this.relayUrl = options.relayUrl;
    this.allowInsecureRelay = options.allowInsecureRelay;
    this.remoteAccessState = options.remoteAccessState;
    this.hostId = options.hostId;
    this.hostName = options.hostName;
    this.commandHandler = options.commandHandler;
    this.onStatus = options.onStatus || (() => {});
    this.onApprovalRequired = options.onApprovalRequired || (() => {});
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2_000;

    this.ws = null;
    this.heartbeatTimer = null;
    this.closedByClient = false;
    this.sessionId = null;
    this.pendingAdmin = new Map();
  }

  statusSnapshot() {
    return {
      connected: !!this.sessionId && this.ws?.readyState === WebSocket.OPEN,
      relay_url: this.relayUrl,
      host_id: this.hostId,
      session_id: this.sessionId,
    };
  }

  async start() {
    if (!this.relayUrl) {
      return;
    }
    if (!this.allowInsecureRelay) {
      const parsed = new URL(this.relayUrl);
      if (parsed.protocol !== "https:") {
        throw new Error("relay_requires_https");
      }
    }
    this.closedByClient = false;
    await this._connectLoop();
  }

  async close() {
    this.closedByClient = true;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.sessionId = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  async _connectLoop() {
    while (!this.closedByClient) {
      try {
        await this._connectOnce();
        return;
      } catch (error) {
        this.onStatus({ type: "remote_relay_error", detail: error?.message || String(error) });
        await sleep(this.reconnectDelayMs);
      }
    }
  }

  _connectOnce() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(toWebSocketUrl(this.relayUrl), {
        headers: {
          "x-magichat-host-id": this.hostId,
          "x-magichat-protocol-version": "2",
        },
      });
      this.ws = ws;

      let authenticated = false;

      ws.on("open", () => {
        this.onStatus({ type: "remote_connecting", relay_url: this.relayUrl });
      });

      ws.on("message", async (buffer) => {
        try {
          const payload = JSON.parse(buffer.toString("utf8"));
          if (payload.type === "host_challenge") {
            const identity = this.remoteAccessState.hostIdentity(this.hostId, this.hostName);
            this._send({
              type: "host_hello",
              protocol_version: 2,
              host_id: this.hostId,
              host_name: this.hostName,
              host_public_key: identity.public_key,
              signature: this.remoteAccessState.signChallenge(payload.challenge),
              challenge: payload.challenge,
              meta: {
                app_version: "0.1.0",
                platform: process.platform,
              },
            });
            return;
          }

          if (payload.type === "host_attest") {
            authenticated = true;
            this.sessionId = payload.session_id;
            this._beginHeartbeat();
            this.onStatus({ type: "remote_connected", session_id: this.sessionId, relay_url: this.relayUrl });
            resolve();
            return;
          }

          if (payload.type === "device_approval_required") {
            this.remoteAccessState.recordPendingApproval(payload);
            this.onApprovalRequired(payload);
            return;
          }

          if (payload.type === "command_envelope") {
            try {
              const result = await this.commandHandler(payload.command, {
                requestId: payload.request_id,
                sendUpdate: (update) =>
                  this._send({
                    type: "instance_update",
                    protocol_version: 2,
                    subscription_id: update.subscription_id,
                    host_id: this.hostId,
                    instance_id: update.instance_id,
                    event: update.event,
                  }),
              });
              this._send({
                type: "command_result",
                protocol_version: 2,
                request_id: payload.request_id,
                ok: true,
                result,
              });
            } catch (error) {
              this._send({
                type: "command_result",
                protocol_version: 2,
                request_id: payload.request_id,
                ok: false,
                error: {
                  code: error?.code || "internal_error",
                  message: error?.message || String(error),
                },
              });
            }
            return;
          }

          if (payload.type === "host_admin_result") {
            const pending = this.pendingAdmin.get(payload.request_id);
            if (pending) {
              this.pendingAdmin.delete(payload.request_id);
              pending.resolve(payload);
            }
            return;
          }
        } catch (error) {
          this.onStatus({ type: "remote_protocol_error", detail: error?.message || String(error) });
        }
      });

      ws.on("close", async () => {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        this.sessionId = null;
        this.onStatus({ type: "remote_disconnected", relay_url: this.relayUrl });
        if (!this.closedByClient && authenticated) {
          await this._connectLoop();
        } else if (!authenticated) {
          reject(new Error("relay_auth_failed"));
        }
      });

      ws.on("error", (error) => {
        if (!authenticated) {
          reject(error);
        }
      });
    });
  }

  _beginHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this._send({
        type: "heartbeat",
        protocol_version: 2,
        host_id: this.hostId,
        session_id: this.sessionId,
        ts: new Date().toISOString(),
      });
    }, this.heartbeatIntervalMs);
  }

  _send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }

  async approveClaim(claimId) {
    this.remoteAccessState.markApprovalDecision(claimId, "approved");
    this._send({
      type: "device_registration_approved",
      protocol_version: 2,
      claim_id: claimId,
    });
  }

  async rejectClaim(claimId) {
    this.remoteAccessState.markApprovalDecision(claimId, "rejected");
    this._send({
      type: "disconnect_reason",
      protocol_version: 2,
      claim_id: claimId,
      reason: "approval_rejected",
    });
  }

  async listDevices() {
    return this._requestAdmin("list_devices", {});
  }

  async revokeDevice(deviceId) {
    return this._requestAdmin("revoke_device", { device_id: deviceId });
  }

  _requestAdmin(action, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) {
      throw new Error("host_offline");
    }
    const requestId = `admin_${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAdmin.delete(requestId);
        reject(new Error("relay_admin_timeout"));
      }, 10000);
      this.pendingAdmin.set(requestId, {
        resolve: (payload) => {
          clearTimeout(timeout);
          resolve(payload.result);
        },
        reject,
      });
      this._send({
        type: "host_admin_request",
        protocol_version: 2,
        request_id: requestId,
        action,
        params,
      });
    });
  }
}
