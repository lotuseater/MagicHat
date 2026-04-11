import crypto from "node:crypto";
import { readJsonFileSync, writeJsonFileSync } from "../state/jsonStateStore.js";

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signPayload(payload, privateKeyPem) {
  return crypto.sign(null, Buffer.from(payload, "utf8"), privateKeyPem);
}

function fingerprintForPublicKey(publicKeyPem) {
  const der = crypto
    .createPublicKey(publicKeyPem)
    .export({ type: "spki", format: "der" });
  return `sha256:${crypto.createHash("sha256").update(der).digest("hex")}`;
}

function restoreRefForPath(restorePath) {
  return `restore_${crypto.createHash("sha256").update(restorePath, "utf8").digest("hex").slice(0, 24)}`;
}

export class RemoteAccessState {
  constructor({ statePath, clock = () => Date.now() }) {
    this.statePath = statePath;
    this.clock = clock;
    this.state = readJsonFileSync(this.statePath, {
      host_keys: null,
      pending_approvals: [],
      known_restore_refs: [],
    });
    this._ensureKeys();
    this._pruneExpiredApprovals();
    this.persist();
  }

  persist() {
    writeJsonFileSync(this.statePath, this.state);
  }

  _ensureKeys() {
    if (this.state.host_keys?.public_key && this.state.host_keys?.private_key) {
      return;
    }

    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

    this.state.host_keys = {
      public_key: publicKeyPem,
      private_key: privateKeyPem,
      fingerprint: fingerprintForPublicKey(publicKeyPem),
      created_at_ms: this.clock(),
    };
  }

  _pruneExpiredApprovals() {
    const now = this.clock();
    this.state.pending_approvals = (this.state.pending_approvals || []).filter(
      (entry) => (entry.expires_at_ms || now + 1) > now && entry.status === "pending",
    );
  }

  hostIdentity(hostId, hostName) {
    this._ensureKeys();
    return {
      host_id: hostId,
      host_name: hostName,
      public_key: this.state.host_keys.public_key,
      private_key: this.state.host_keys.private_key,
      fingerprint: this.state.host_keys.fingerprint,
    };
  }

  signChallenge(challenge) {
    this._ensureKeys();
    return base64UrlEncode(signPayload(challenge, this.state.host_keys.private_key));
  }

  createPairingBootstrap({ relayUrl, hostId, hostName, ttlMs = 10 * 60 * 1000 }) {
    const now = this.clock();
    const expMs = now + ttlMs;
    const payload = {
      v: 2,
      jti: `bt_${crypto.randomUUID()}`,
      host_id: hostId,
      host_name: hostName,
      exp: new Date(expMs).toISOString(),
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = base64UrlEncode(signPayload(encodedPayload, this.state.host_keys.private_key));
    const bootstrapToken = `${encodedPayload}.${signature}`;
    const query = new URLSearchParams({
      v: "2",
      relay: relayUrl,
      host_id: hostId,
      host_name: hostName,
      bootstrap_token: bootstrapToken,
      host_fingerprint: this.state.host_keys.fingerprint,
      exp: payload.exp,
    });

    return {
      bootstrap_token: bootstrapToken,
      payload,
      host_fingerprint: this.state.host_keys.fingerprint,
      expires_at: payload.exp,
      pair_uri: `magichat://pair?${query.toString()}`,
    };
  }

  recordPendingApproval(request) {
    const pending = {
      claim_id: request.claim_id,
      device_name: request.device_name,
      platform: request.platform,
      created_at_ms: this.clock(),
      expires_at_ms: request.expires_at_ms || this.clock() + 10 * 60 * 1000,
      status: "pending",
    };
    this.state.pending_approvals = [
      ...(this.state.pending_approvals || []).filter((entry) => entry.claim_id !== request.claim_id),
      pending,
    ];
    this.persist();
    return pending;
  }

  listPendingApprovals() {
    this._pruneExpiredApprovals();
    this.persist();
    return [...(this.state.pending_approvals || [])].sort((lhs, rhs) => rhs.created_at_ms - lhs.created_at_ms);
  }

  markApprovalDecision(claimId, status) {
    this.state.pending_approvals = (this.state.pending_approvals || []).map((entry) =>
      entry.claim_id === claimId
        ? { ...entry, status, decided_at_ms: this.clock() }
        : entry,
    );
    this._pruneExpiredApprovals();
    this.persist();
  }

  rememberRestorePath(restorePath, meta = {}) {
    if (!restorePath || typeof restorePath !== "string") {
      return null;
    }

    const restoreRef = restoreRefForPath(restorePath);
    const next = {
      restore_ref: restoreRef,
      restore_path: restorePath,
      session_id: meta.session_id || "",
      title: meta.title || "",
      observed_at_ms: this.clock(),
    };

    this.state.known_restore_refs = [
      ...(this.state.known_restore_refs || []).filter((entry) => entry.restore_ref !== restoreRef),
      next,
    ].slice(-200);
    this.persist();
    return restoreRef;
  }

  rememberRestoreRefsFromInstances(instances) {
    for (const instance of instances || []) {
      this.rememberRestorePath(instance.restore_state_path, {
        session_id: instance.session_id,
        title:
          instance.current_task_state?.task ||
          instance.result_summary?.short_text ||
          instance.instance_id ||
          String(instance.pid),
      });
    }
  }

  resolveRestoreRef(restoreRef) {
    return (
      (this.state.known_restore_refs || []).find((entry) => entry.restore_ref === restoreRef)?.restore_path ||
      null
    );
  }

  listKnownRestoreRefs() {
    return [...(this.state.known_restore_refs || [])]
      .sort((lhs, rhs) => rhs.observed_at_ms - lhs.observed_at_ms)
      .map((entry) => ({
        restore_ref: entry.restore_ref,
        session_id: entry.session_id,
        title: entry.title,
        observed_at: new Date(entry.observed_at_ms).toISOString(),
      }));
  }
}
