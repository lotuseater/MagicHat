import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { readJsonFileSync, writeJsonFileSync } from "../state/jsonStateStore.js";

function defaultCodeGenerator() {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function issueToken() {
  return crypto.randomBytes(24).toString("hex");
}

export class PairingManager extends EventEmitter {
  constructor(options) {
    super();
    this.statePath = options.statePath;
    this.clock = options.clock || (() => Date.now());
    this.generateCode = options.generateCode || defaultCodeGenerator;
    this.pairingCodeTtlMs = options.pairingCodeTtlMs;
    this.tokenTtlMs = options.tokenTtlMs;

    this.state = readJsonFileSync(this.statePath, {
      host_id: crypto.randomUUID(),
      active_pairing: null,
      paired_devices: [],
    });
    if (!this.state.host_id) {
      this.state.host_id = crypto.randomUUID();
    }
    this.purgeExpired();
  }

  purgeExpired() {
    const now = this.clock();
    if (this.state.active_pairing && this.state.active_pairing.expires_at_ms <= now) {
      this.state.active_pairing = null;
    }

    this.state.paired_devices = (this.state.paired_devices || []).filter(
      (device) => device.expires_at_ms > now,
    );
    this.persist();
  }

  persist() {
    writeJsonFileSync(this.statePath, this.state);
  }

  issuePairingCode() {
    const now = this.clock();
    const pairing = {
      code: this.generateCode(),
      issued_at_ms: now,
      expires_at_ms: now + this.pairingCodeTtlMs,
    };

    this.state.active_pairing = pairing;
    this.persist();
    this.emit("pairing_code_issued", pairing);

    return pairing;
  }

  getActivePairingCode() {
    this.purgeExpired();
    if (!this.state.active_pairing) {
      this.issuePairingCode();
    }
    return this.state.active_pairing;
  }

  exchangePairingCode({ pairingCode, deviceName, deviceId }) {
    this.purgeExpired();
    const activePairing = this.state.active_pairing;
    if (!activePairing) {
      return { status: "expired_or_used" };
    }
    if (activePairing.code !== pairingCode) {
      return { status: "invalid_code" };
    }

    const now = this.clock();
    const token = issueToken();
    const record = {
      token,
      device_name: deviceName?.trim() || "mobile-device",
      device_id: deviceId?.trim() || null,
      created_at_ms: now,
      expires_at_ms: now + this.tokenTtlMs,
    };

    this.state.active_pairing = null;
    this.state.paired_devices = [...(this.state.paired_devices || []), record];
    this.persist();

    // Immediately mint a fresh pairing code so the host can re-pair after a
    // Forget PC or additional device without restarting the process. The
    // emitted event lets index.js (or any UI) print the new code to console.
    this.issuePairingCode();

    return { status: "ok", record };
  }

  // Operator-facing helper: forget a previously paired device (by token or
  // device_id) without re-pairing. Returns true if something was removed.
  removePairedDevice({ token, deviceId } = {}) {
    const before = (this.state.paired_devices || []).length;
    this.state.paired_devices = (this.state.paired_devices || []).filter((entry) => {
      if (token && entry.token === token) return false;
      if (deviceId && entry.device_id === deviceId) return false;
      return true;
    });
    const removed = this.state.paired_devices.length !== before;
    if (removed) {
      this.persist();
    }
    return removed;
  }

  validateToken(token) {
    if (!token) {
      return null;
    }

    this.purgeExpired();
    return (this.state.paired_devices || []).find((entry) => entry.token === token) || null;
  }

  hostId() {
    return this.state.host_id;
  }
}

export function extractBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== "string") {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}
