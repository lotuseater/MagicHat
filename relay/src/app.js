import express from "express";
import { WebSocketServer } from "ws";
import { readRelayConfig } from "./config.js";
import {
  fingerprintForPublicKey,
  hashOpaqueToken,
  nowMs,
  randomChallenge,
  randomId,
  randomToken,
  base64UrlDecodeToString,
  verifyBootstrapToken,
  verifyDetachedSignature,
} from "./crypto.js";
import { createRelayStore } from "./store.js";

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function sendSse(res, eventName, payload, id = null) {
  if (id) {
    res.write(`id: ${id}\n`);
  }
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function extractBearerToken(header) {
  if (!header || typeof header !== "string") {
    return null;
  }
  const [scheme, token] = header.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  check(key) {
    const now = nowMs();
    const bucket = (this.buckets.get(key) || []).filter((entry) => entry > now - this.windowMs);
    if (bucket.length >= this.limit) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.push(now);
    this.buckets.set(key, bucket);
    return true;
  }
}

function requireHostScope(req, res, next) {
  if (!req.auth || req.auth.host_id !== req.params.hostId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

export async function createRelayRuntime(options = {}) {
  const config = options.config || readRelayConfig();
  const store = options.store || createRelayStore(config);
  await store.init();

  const hostConnections = new Map();
  const pendingCommands = new Map();
  const subscriptions = new Map();
  const wss = new WebSocketServer({ noServer: true });

  const bootstrapLimiter = new RateLimiter({
    limit: config.bootstrapClaimLimit,
    windowMs: config.rateLimitWindowMs,
  });
  const refreshLimiter = new RateLimiter({
    limit: config.refreshLimit,
    windowMs: config.rateLimitWindowMs,
  });
  const commandLimiter = new RateLimiter({
    limit: config.commandLimit,
    windowMs: config.rateLimitWindowMs,
  });
  const heartbeatSweeper = setInterval(() => {
    const now = nowMs();
    for (const connection of hostConnections.values()) {
      if (now - connection.lastSeenAtMs > config.heartbeatTimeoutMs) {
        try {
          connection.ws.close();
        } catch {}
      }
    }
  }, Math.max(5_000, Math.floor(config.heartbeatTimeoutMs / 2)));

  async function audit(eventType, { hostId = null, deviceId = null, metadata = {} } = {}) {
    await store.appendAuditEvent({
      auditEventId: randomId("audit"),
      hostId,
      deviceId,
      eventType,
      metadata,
      nowMs: nowMs(),
    });
  }

  function currentHostState(hostId) {
    const connected = hostConnections.get(hostId);
    return connected
      ? {
          status: "online",
          last_seen_at: new Date(connected.lastSeenAtMs).toISOString(),
          host_name: connected.hostName,
        }
      : {
          status: "offline",
          last_seen_at: null,
          host_name: null,
        };
  }

  function sendHostMessage(hostId, payload) {
    const connection = hostConnections.get(hostId);
    if (!connection || connection.ws.readyState !== 1) {
      const error = new Error("host_offline");
      error.code = "host_offline";
      throw error;
    }
    connection.ws.send(JSON.stringify(payload));
  }

  function rejectPendingForHost(hostId) {
    for (const [requestId, pending] of pendingCommands.entries()) {
      if (pending.hostId === hostId) {
        clearTimeout(pending.timeout);
        pending.reject(Object.assign(new Error("host_offline"), { code: "host_offline" }));
        pendingCommands.delete(requestId);
      }
    }
  }

  function closeSubscriptionsForHost(hostId) {
    for (const [subscriptionId, subscription] of subscriptions.entries()) {
      if (subscription.hostId !== hostId) {
        continue;
      }
      try {
        sendSse(subscription.res, "disconnect_reason", { reason: "host_offline" });
      } catch {}
      subscription.res.end();
      subscriptions.delete(subscriptionId);
    }
  }

  async function closeTrackedSocket(ws) {
    if (!ws) {
      return;
    }
    if (ws.readyState === 3) {
      return;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      ws.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        if (ws.readyState !== 2) {
          ws.close();
        }
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  function dispatchCommandToHost(hostId, command) {
    const requestId = randomId("req");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingCommands.delete(requestId);
        reject(Object.assign(new Error("host_timeout"), { code: "host_timeout" }));
      }, config.requestTimeoutMs);

      pendingCommands.set(requestId, {
        hostId,
        resolve: (payload) => {
          clearTimeout(timeout);
          resolve(payload);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout,
      });
      try {
        sendHostMessage(hostId, {
          type: "command_envelope",
          protocol_version: 2,
          request_id: requestId,
          host_id: hostId,
          command,
        });
      } catch (error) {
        clearTimeout(timeout);
        pendingCommands.delete(requestId);
        reject(error);
      }
    });
  }

  async function authenticateAccessToken(req, res, next) {
    const token = extractBearerToken(req.get("authorization"));
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const access = await store.findAccessToken(hashOpaqueToken(token));
    const now = nowMs();
    if (
      !access ||
      access.revoked_at_ms ||
      access.device_revoked_at_ms ||
      Number(access.expires_at_ms) <= now
    ) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    req.auth = {
      device_id: access.device_id,
      host_id: access.host_id,
      device_name: access.device_name,
      platform: access.platform,
      host_name: access.host_name,
    };
    next();
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", service: "magichat-relay", ts: nowMs() });
  });

  app.post(
    "/v2/mobile/pair/bootstrap/claim",
    asyncRoute(async (req, res) => {
      const bucketKey = req.ip || req.socket.remoteAddress || "unknown";
      if (!bootstrapLimiter.check(bucketKey)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }

      const bootstrapToken = `${req.body?.bootstrap_token || ""}`.trim();
      const deviceName = `${req.body?.device_name || ""}`.trim();
      const platform = `${req.body?.platform || ""}`.trim() || "unknown";
      const devicePublicKey = `${req.body?.device_public_key || ""}`.trim();
      if (!bootstrapToken || !deviceName || !devicePublicKey) {
        res.status(400).json({ error: "bad_request" });
        return;
      }

      const tokenPayloadEncoded = bootstrapToken.split(".")[0];
      if (!tokenPayloadEncoded) {
        res.status(400).json({ error: "bootstrap_token_invalid" });
        return;
      }

      let bootstrapPayload = null;
      const tokenHash = hashOpaqueToken(bootstrapToken);
      const fakeDecoded = JSON.parse(base64UrlDecodeToString(tokenPayloadEncoded));
      const host = await store.getHost(fakeDecoded.host_id);
      if (!host) {
        res.status(401).json({ error: "bootstrap_token_invalid" });
        return;
      }
      bootstrapPayload = verifyBootstrapToken(bootstrapToken, host.public_key);
      if (!bootstrapPayload) {
        res.status(401).json({ error: "bootstrap_token_invalid" });
        return;
      }

      const now = nowMs();
      const expMs = Date.parse(bootstrapPayload.exp);
      if (!Number.isFinite(expMs) || expMs <= now) {
        res.status(409).json({ error: "bootstrap_token_expired" });
        return;
      }

      const claimId = randomId("claim");
      const claimed = await store.claimBootstrapToken({
        jti: bootstrapPayload.jti,
        hostId: bootstrapPayload.host_id,
        hostName: bootstrapPayload.host_name,
        tokenHash,
        expiresAtMs: expMs,
        claimId,
        deviceName,
        platform,
        devicePublicKey,
        nowMs: now,
      });

      if (claimed.status !== "ok") {
        res.status(409).json({ error: "bootstrap_token_used" });
        return;
      }

      await audit("bootstrap_claimed", {
        hostId: bootstrapPayload.host_id,
        metadata: { claim_id: claimId, platform, device_name: deviceName },
      });

      try {
        sendHostMessage(bootstrapPayload.host_id, {
          type: "device_approval_required",
          protocol_version: 2,
          claim_id: claimId,
          device_name: deviceName,
          platform,
          expires_at_ms: expMs,
        });
      } catch {
        // Claim stays pending until the host reconnects.
      }

      res.status(202).json({
        claim_id: claimId,
        status: "pending_approval",
        host_id: bootstrapPayload.host_id,
        host_name: bootstrapPayload.host_name,
      });
    }),
  );

  app.get(
    "/v2/mobile/pair/bootstrap/claims/:claimId",
    asyncRoute(async (req, res) => {
      const claim = await store.getClaim(req.params.claimId);
      if (!claim) {
        res.status(404).json({ error: "claim_not_found" });
        return;
      }

      const payload = {
        claim_id: claim.claim_id,
        status: claim.status,
      };
      if (claim.status === "approved") {
        payload.challenge = claim.challenge;
        payload.host_id = claim.host_id;
        payload.host_name = claim.host_name;
      }
      res.json(payload);
    }),
  );

  app.post(
    "/v2/mobile/pair/device/register",
    asyncRoute(async (req, res) => {
      const claimId = `${req.body?.claim_id || ""}`.trim();
      const challenge = `${req.body?.challenge || ""}`.trim();
      const signature = `${req.body?.signature || ""}`.trim();
      if (!claimId || !challenge || !signature) {
        res.status(400).json({ error: "bad_request" });
        return;
      }

      const claim = await store.getClaim(claimId);
      if (!claim) {
        res.status(404).json({ error: "claim_not_found" });
        return;
      }
      if (claim.status === "rejected") {
        res.status(409).json({ error: "claim_rejected" });
        return;
      }
      if (claim.status !== "approved" || claim.challenge !== challenge) {
        res.status(409).json({ error: "claim_not_ready" });
        return;
      }
      if (!verifyDetachedSignature(challenge, signature, claim.device_public_key)) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const now = nowMs();
      const deviceId = randomId("device");
      const accessToken = randomToken("at");
      const refreshToken = randomToken("rt");
      const registered = await store.completeClaimRegistration({
        claimId,
        deviceId,
        nowMs: now,
        accessTokenId: randomId("access"),
        accessTokenHash: hashOpaqueToken(accessToken),
        accessExpiresAtMs: now + config.accessTokenTtlMs,
        refreshTokenId: randomId("refresh"),
        refreshTokenHash: hashOpaqueToken(refreshToken),
        refreshExpiresAtMs: now + config.refreshTokenTtlMs,
      });

      if (!registered) {
        res.status(409).json({ error: "claim_not_ready" });
        return;
      }

      await audit("device_registered", {
        hostId: registered.host_id,
        deviceId,
        metadata: { claim_id: claimId, platform: registered.platform },
      });

      res.status(201).json({
        host_id: registered.host_id,
        host_name: registered.host_name,
        device_id: deviceId,
        access_token: accessToken,
        access_token_expires_at: new Date(now + config.accessTokenTtlMs).toISOString(),
        refresh_token: refreshToken,
        refresh_token_expires_at: new Date(now + config.refreshTokenTtlMs).toISOString(),
        certificate_pinset_version: config.certificatePinsetVersion,
      });
    }),
  );

  app.post(
    "/v2/mobile/session/refresh",
    asyncRoute(async (req, res) => {
      const bucketKey = req.ip || req.socket.remoteAddress || "unknown";
      if (!refreshLimiter.check(bucketKey)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      const refreshToken = `${req.body?.refresh_token || ""}`.trim();
      if (!refreshToken) {
        res.status(400).json({ error: "bad_request" });
        return;
      }

      const existing = await store.findRefreshToken(hashOpaqueToken(refreshToken));
      const now = nowMs();
      if (!existing) {
        res.status(401).json({ error: "refresh_token_invalid" });
        return;
      }
      if (existing.revoked_at_ms || existing.device_revoked_at_ms || Number(existing.expires_at_ms) <= now) {
        res.status(401).json({ error: "refresh_token_invalid" });
        return;
      }
      if (existing.status !== "active") {
        await store.revokeDevice(existing.device_id, now);
        await audit("refresh_reuse_detected", {
          hostId: existing.host_id,
          deviceId: existing.device_id,
          metadata: { refresh_token_id: existing.refresh_token_id },
        });
        res.status(409).json({ error: "refresh_token_reused" });
        return;
      }

      const nextAccessToken = randomToken("at");
      const nextRefreshToken = randomToken("rt");
      await store.rotateRefreshToken({
        currentRefreshTokenId: existing.refresh_token_id,
        deviceId: existing.device_id,
        hostId: existing.host_id,
        nowMs: now,
        accessTokenId: randomId("access"),
        accessTokenHash: hashOpaqueToken(nextAccessToken),
        accessExpiresAtMs: now + config.accessTokenTtlMs,
        refreshTokenId: randomId("refresh"),
        refreshTokenHash: hashOpaqueToken(nextRefreshToken),
        refreshExpiresAtMs: now + config.refreshTokenTtlMs,
      });

      await audit("refresh_rotated", {
        hostId: existing.host_id,
        deviceId: existing.device_id,
        metadata: { refresh_token_id: existing.refresh_token_id },
      });

      res.json({
        access_token: nextAccessToken,
        access_token_expires_at: new Date(now + config.accessTokenTtlMs).toISOString(),
        refresh_token: nextRefreshToken,
        refresh_token_expires_at: new Date(now + config.refreshTokenTtlMs).toISOString(),
      });
    }),
  );

  app.use("/v2/mobile", authenticateAccessToken);

  app.get(
    "/v2/mobile/hosts",
    asyncRoute(async (req, res) => {
      const host = await store.getHostForDevice(req.auth.device_id);
      if (!host) {
        res.json({ hosts: [] });
        return;
      }
      const state = currentHostState(host.host_id);
      res.json({
        hosts: [
          {
            host_id: host.host_id,
            host_name: host.host_name,
            status: state.status,
            last_seen_at: state.last_seen_at,
          },
        ],
      });
    }),
  );

  app.get(
    "/v2/mobile/devices",
    asyncRoute(async (req, res) => {
      const devices = await store.listDevices(req.auth.host_id);
      res.json({ devices });
    }),
  );

  app.delete(
    "/v2/mobile/devices/:deviceId",
    asyncRoute(async (req, res) => {
      await store.revokeDevice(req.params.deviceId, nowMs());
      await audit("device_revoked", {
        hostId: req.auth.host_id,
        deviceId: req.params.deviceId,
        metadata: { revoked_by: req.auth.device_id },
      });
      res.json({ status: "revoked" });
    }),
  );

  app.use("/v2/mobile/hosts/:hostId", requireHostScope);

  app.get(
    "/v2/mobile/hosts/:hostId/instances",
    asyncRoute(async (req, res) => {
      if (!commandLimiter.check(req.auth.device_id)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "list_instances",
        params: {},
      });
      res.json(result.result);
    }),
  );

  app.post(
    "/v2/mobile/hosts/:hostId/instances",
    asyncRoute(async (req, res) => {
      if (!commandLimiter.check(req.auth.device_id)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "launch_instance",
        params: {
          title: `${req.body?.title || ""}`.trim() || null,
          restore_ref: `${req.body?.restore_ref || ""}`.trim() || null,
          team_mode: `${req.body?.team_mode || ""}`.trim() || null,
          launcher_preset: `${req.body?.launcher_preset || ""}`.trim() || null,
          fenrus_launcher: `${req.body?.fenrus_launcher || ""}`.trim() || null,
        },
      });
      res.status(201).json(result.result);
    }),
  );

  app.get(
    "/v2/mobile/hosts/:hostId/instances/:instanceId",
    asyncRoute(async (req, res) => {
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "get_instance_detail",
        params: {
          instance_id: req.params.instanceId,
        },
      });
      res.json(result.result);
    }),
  );

  app.post(
    "/v2/mobile/hosts/:hostId/instances/:instanceId/prompt",
    asyncRoute(async (req, res) => {
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "send_prompt",
        params: {
          instance_id: req.params.instanceId,
          prompt: `${req.body?.prompt || ""}`.trim(),
        },
      });
      res.status(202).json(result.result);
    }),
  );

  app.post(
    "/v2/mobile/hosts/:hostId/instances/:instanceId/follow-up",
    asyncRoute(async (req, res) => {
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "send_follow_up",
        params: {
          instance_id: req.params.instanceId,
          message: `${req.body?.message || ""}`.trim(),
        },
      });
      res.status(202).json(result.result);
    }),
  );

  app.post(
    "/v2/mobile/hosts/:hostId/instances/:instanceId/trust",
    asyncRoute(async (req, res) => {
      if (typeof req.body?.approved !== "boolean") {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "answer_trust_prompt",
        params: {
          instance_id: req.params.instanceId,
          approved: req.body.approved,
        },
      });
      res.status(202).json(result.result);
    }),
  );

  app.post(
    "/v2/mobile/hosts/:hostId/instances/:instanceId/restore",
    asyncRoute(async (req, res) => {
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "restore_instance",
        params: {
          instance_id: req.params.instanceId,
          restore_ref: `${req.body?.restore_ref || ""}`.trim(),
        },
      });
      res.status(202).json(result.result);
    }),
  );

  app.delete(
    "/v2/mobile/hosts/:hostId/instances/:instanceId",
    asyncRoute(async (req, res) => {
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "close_instance",
        params: {
          instance_id: req.params.instanceId,
        },
      });
      res.status(202).json(result.result);
    }),
  );

  app.get(
    "/v2/mobile/hosts/:hostId/restore-refs",
    asyncRoute(async (req, res) => {
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "list_known_restore_refs",
        params: {},
      });
      res.json(result.result);
    }),
  );

  app.get(
    "/v2/mobile/hosts/:hostId/cli-instances/presets",
    asyncRoute(async (req, res) => {
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "list_cli_presets",
        params: {},
      });
      res.json(result.result);
    }),
  );

  app.get(
    "/v2/mobile/hosts/:hostId/cli-instances",
    asyncRoute(async (req, res) => {
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "list_cli_instances",
        params: {},
      });
      res.json(result.result);
    }),
  );

  app.post(
    "/v2/mobile/hosts/:hostId/cli-instances",
    asyncRoute(async (req, res) => {
      if (!commandLimiter.check(req.auth.device_id)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "launch_cli_instance",
        params: {
          preset: `${req.body?.preset || ""}`.trim() || null,
          title: `${req.body?.title || ""}`.trim() || null,
          initial_prompt: `${req.body?.initial_prompt || ""}`.trim() || null,
          extra_args: Array.isArray(req.body?.extra_args) ? req.body.extra_args : null,
        },
      });
      res.status(201).json(result.result);
    }),
  );

  app.get(
    "/v2/mobile/hosts/:hostId/cli-instances/:instanceId",
    asyncRoute(async (req, res) => {
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "get_cli_instance",
        params: { instance_id: req.params.instanceId },
      });
      res.json(result.result);
    }),
  );

  app.delete(
    "/v2/mobile/hosts/:hostId/cli-instances/:instanceId",
    asyncRoute(async (req, res) => {
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "close_cli_instance",
        params: {
          instance_id: req.params.instanceId,
          force: `${req.query?.force || ""}` === "true",
        },
      });
      res.status(202).json(result.result);
    }),
  );

  app.post(
    "/v2/mobile/hosts/:hostId/cli-instances/:instanceId/prompt",
    asyncRoute(async (req, res) => {
      if (!commandLimiter.check(req.auth.device_id)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      const prompt = `${req.body?.prompt || ""}`.trim();
      if (!prompt) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      const result = await dispatchCommandToHost(req.params.hostId, {
        kind: "send_cli_prompt",
        params: { instance_id: req.params.instanceId, prompt },
      });
      res.status(202).json(result.result);
    }),
  );

  app.get(
    "/v2/mobile/hosts/:hostId/cli-instances/:instanceId/updates",
    asyncRoute(async (req, res) => {
      const subscriptionId = randomId("sub");
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      subscriptions.set(subscriptionId, {
        subscriptionId,
        hostId: req.params.hostId,
        instanceId: req.params.instanceId,
        res,
      });

      try {
        await dispatchCommandToHost(req.params.hostId, {
          kind: "subscribe_cli_updates",
          params: {
            subscription_id: subscriptionId,
            instance_id: req.params.instanceId,
          },
        });
      } catch (error) {
        subscriptions.delete(subscriptionId);
        throw error;
      }

      req.on("close", async () => {
        subscriptions.delete(subscriptionId);
        try {
          await dispatchCommandToHost(req.params.hostId, {
            kind: "unsubscribe_cli_updates",
            params: { subscription_id: subscriptionId },
          });
        } catch {}
      });
    }),
  );

  app.get(
    "/v2/mobile/hosts/:hostId/instances/:instanceId/updates",
    asyncRoute(async (req, res) => {
      const subscriptionId = randomId("sub");
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      subscriptions.set(subscriptionId, {
        subscriptionId,
        hostId: req.params.hostId,
        instanceId: req.params.instanceId,
        res,
      });

      try {
        await dispatchCommandToHost(req.params.hostId, {
          kind: "subscribe_instance_updates",
          params: {
            subscription_id: subscriptionId,
            instance_id: req.params.instanceId,
          },
        });
      } catch (error) {
        subscriptions.delete(subscriptionId);
        throw error;
      }

      req.on("close", async () => {
        subscriptions.delete(subscriptionId);
        try {
          await dispatchCommandToHost(req.params.hostId, {
            kind: "unsubscribe_instance_updates",
            params: {
              subscription_id: subscriptionId,
            },
          });
        } catch {}
      });
    }),
  );

  app.use((error, _req, res, _next) => {
    if (res.headersSent) {
      return;
    }
    const code = error?.code || error?.message || "internal_error";
    const status =
      code === "host_offline"
        ? 409
        : code === "instance_not_found"
          ? 404
          : code === "restore_ref_not_allowed"
            ? 400
            : 500;
    res.status(status).json({ error: code, detail: error?.message || "unknown" });
  });

  function attachServer(server) {
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname !== "/v2/host/connect") {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    });
  }

  wss.on("connection", (ws, request) => {
    const challengedHostId = request.headers["x-magichat-host-id"];
    const challenge = randomChallenge();
    ws.session = null;
    ws.hostId = challengedHostId;
    ws.send(
      JSON.stringify({
        type: "host_challenge",
        protocol_version: 2,
        challenge,
        ts: new Date().toISOString(),
      }),
    );

    ws.on("message", async (buffer) => {
      try {
        const payload = JSON.parse(buffer.toString("utf8"));
        if (payload.type === "host_hello") {
          if (payload.host_id !== challengedHostId || payload.challenge !== challenge) {
            ws.close();
            return;
          }
          if (
            !verifyDetachedSignature(payload.challenge, payload.signature, payload.host_public_key)
          ) {
            ws.close();
            return;
          }

          const existingHost = await store.getHost(payload.host_id);
          const fingerprint = fingerprintForPublicKey(payload.host_public_key);
          if (existingHost && existingHost.public_key !== payload.host_public_key) {
            ws.close();
            return;
          }

          const connectedAt = nowMs();
          const sessionId = randomId("hs");
          await store.upsertHost({
            hostId: payload.host_id,
            hostName: payload.host_name,
            publicKey: payload.host_public_key,
            fingerprint,
            nowMs: connectedAt,
          });
          await store.beginHostSession({
            sessionId,
            hostId: payload.host_id,
            nowMs: connectedAt,
            meta: payload.meta,
          });
          if (hostConnections.has(payload.host_id)) {
            try {
              hostConnections.get(payload.host_id).ws.close();
            } catch {}
          }
          hostConnections.set(payload.host_id, {
            ws,
            sessionId,
            hostId: payload.host_id,
            hostName: payload.host_name,
            lastSeenAtMs: connectedAt,
          });
          ws.session = { sessionId, hostId: payload.host_id };
          await audit("host_connected", {
            hostId: payload.host_id,
            metadata: { session_id: sessionId, host_name: payload.host_name },
          });
          ws.send(
            JSON.stringify({
              type: "host_attest",
              protocol_version: 2,
              host_id: payload.host_id,
              session_id: sessionId,
              heartbeat_interval_sec: 20,
            }),
          );
          return;
        }

        if (!ws.session) {
          ws.close();
          return;
        }

        if (payload.type === "heartbeat") {
          const current = hostConnections.get(ws.session.hostId);
          if (current) {
            current.lastSeenAtMs = nowMs();
          }
          await store.touchHostSession({
            sessionId: ws.session.sessionId,
            hostId: ws.session.hostId,
            nowMs: nowMs(),
            meta: payload.summary || {},
          });
          return;
        }

        if (payload.type === "device_registration_approved") {
          const challengeValue = randomChallenge();
          await store.approveClaim(payload.claim_id, challengeValue, nowMs());
          await audit("device_approved", {
            hostId: ws.session.hostId,
            metadata: { claim_id: payload.claim_id },
          });
          return;
        }

        if (payload.type === "disconnect_reason" && payload.claim_id && payload.reason === "approval_rejected") {
          await store.rejectClaim(payload.claim_id, nowMs());
          await audit("device_rejected", {
            hostId: ws.session.hostId,
            metadata: { claim_id: payload.claim_id },
          });
          return;
        }

        if (payload.type === "command_result") {
          const pending = pendingCommands.get(payload.request_id);
          if (pending) {
            pendingCommands.delete(payload.request_id);
            if (payload.ok) {
              pending.resolve(payload);
            } else {
              pending.reject(
                Object.assign(new Error(payload.error?.message || payload.error?.code || "command_failed"), {
                  code: payload.error?.code || "command_failed",
                }),
              );
            }
          }
          return;
        }

        if (payload.type === "instance_update") {
          const subscription = subscriptions.get(payload.subscription_id);
          if (subscription) {
            sendSse(subscription.res, "instance_update", payload.event, payload.subscription_id);
          }
          return;
        }

        if (payload.type === "host_admin_request") {
          let result = null;
          if (payload.action === "list_devices") {
            result = await store.listDevices(ws.session.hostId);
          } else if (payload.action === "revoke_device") {
            await store.revokeDevice(payload.params.device_id, nowMs());
            await audit("device_revoked", {
              hostId: ws.session.hostId,
              deviceId: payload.params.device_id,
              metadata: { revoked_by: "host_admin" },
            });
            result = { status: "revoked" };
          } else {
            result = { status: "unsupported" };
          }

          ws.send(
            JSON.stringify({
              type: "host_admin_result",
              protocol_version: 2,
              request_id: payload.request_id,
              result,
            }),
          );
        }
      } catch {
        ws.close();
      }
    });

    ws.on("close", async () => {
      if (ws.session) {
        hostConnections.delete(ws.session.hostId);
        rejectPendingForHost(ws.session.hostId);
        closeSubscriptionsForHost(ws.session.hostId);
        await store.endHostSession({
          sessionId: ws.session.sessionId,
          hostId: ws.session.hostId,
          nowMs: nowMs(),
        });
        await audit("host_disconnected", {
          hostId: ws.session.hostId,
          metadata: { session_id: ws.session.sessionId },
        });
      }
    });
  });

  return {
    app,
    config,
    store,
    attachServer,
    close: async () => {
      clearInterval(heartbeatSweeper);
      const closePromises = [];
      for (const connection of hostConnections.values()) {
        closePromises.push(closeTrackedSocket(connection.ws));
      }
      await Promise.allSettled(closePromises);
      await store.close();
    },
  };
}
