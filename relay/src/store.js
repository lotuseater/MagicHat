import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import pg from "pg";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS hosts (
    host_id TEXT PRIMARY KEY,
    host_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS host_sessions (
    session_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    status TEXT NOT NULL,
    connected_at_ms BIGINT NOT NULL,
    last_seen_at_ms BIGINT NOT NULL,
    meta_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bootstrap_tokens (
    jti TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    host_name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at_ms BIGINT NOT NULL,
    claim_id TEXT NOT NULL,
    status TEXT NOT NULL,
    claimed_at_ms BIGINT NOT NULL,
    completed_at_ms BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS device_claims (
    claim_id TEXT PRIMARY KEY,
    jti TEXT NOT NULL,
    host_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    device_public_key TEXT NOT NULL,
    status TEXT NOT NULL,
    challenge TEXT,
    created_at_ms BIGINT NOT NULL,
    decided_at_ms BIGINT,
    completed_at_ms BIGINT,
    device_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at_ms BIGINT NOT NULL,
    revoked_at_ms BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS access_tokens (
    access_token_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at_ms BIGINT NOT NULL,
    revoked_at_ms BIGINT,
    created_at_ms BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    refresh_token_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at_ms BIGINT NOT NULL,
    status TEXT NOT NULL,
    rotated_from_id TEXT,
    created_at_ms BIGINT NOT NULL,
    revoked_at_ms BIGINT,
    last_used_at_ms BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    audit_event_id TEXT PRIMARY KEY,
    host_id TEXT,
    device_id TEXT,
    event_type TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at_ms BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_host_sessions_host_id ON host_sessions(host_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bootstrap_claims_host_id ON device_claims(host_id)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_host_id ON devices(host_id)`,
  `CREATE INDEX IF NOT EXISTS idx_access_tokens_device_id ON access_tokens(device_id)`,
  `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_device_id ON refresh_tokens(device_id)`,
];

function pgPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

class SqliteAdapter {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
  }

  async init() {
    for (const statement of SCHEMA) {
      this.db.exec(statement);
    }
  }

  async get(sql, params = []) {
    return this.db.prepare(sql).get(...params) || null;
  }

  async all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  async run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  async transaction(fn) {
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async close() {
    this.db.close();
  }
}

class PgAdapter {
  constructor(databaseUrl) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async init() {
    for (const statement of SCHEMA) {
      await this.pool.query(statement);
    }
  }

  async get(sql, params = []) {
    const result = await this.pool.query(pgPlaceholders(sql), params);
    return result.rows[0] || null;
  }

  async all(sql, params = []) {
    const result = await this.pool.query(pgPlaceholders(sql), params);
    return result.rows;
  }

  async run(sql, params = []) {
    return this.pool.query(pgPlaceholders(sql), params);
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    const tx = {
      get: async (sql, params = []) => {
        const result = await client.query(pgPlaceholders(sql), params);
        return result.rows[0] || null;
      },
      all: async (sql, params = []) => {
        const result = await client.query(pgPlaceholders(sql), params);
        return result.rows;
      },
      run: async (sql, params = []) => client.query(pgPlaceholders(sql), params),
    };
    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? {});
}

export class RelayStore {
  constructor(adapter) {
    this.db = adapter;
  }

  async init() {
    await this.db.init();
  }

  async close() {
    await this.db.close();
  }

  async upsertHost({ hostId, hostName, publicKey, fingerprint, nowMs }) {
    const existing = await this.db.get("SELECT host_id FROM hosts WHERE host_id = ?", [hostId]);
    if (existing) {
      await this.db.run(
        "UPDATE hosts SET host_name = ?, public_key = ?, fingerprint = ?, updated_at_ms = ? WHERE host_id = ?",
        [hostName, publicKey, fingerprint, nowMs, hostId],
      );
      return;
    }

    await this.db.run(
      "INSERT INTO hosts (host_id, host_name, public_key, fingerprint, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
      [hostId, hostName, publicKey, fingerprint, nowMs, nowMs],
    );
  }

  async getHost(hostId) {
    return this.db.get("SELECT * FROM hosts WHERE host_id = ?", [hostId]);
  }

  async beginHostSession({ sessionId, hostId, nowMs, meta }) {
    await this.db.run(
      "INSERT INTO host_sessions (session_id, host_id, status, connected_at_ms, last_seen_at_ms, meta_json) VALUES (?, ?, ?, ?, ?, ?)",
      [sessionId, hostId, "connected", nowMs, nowMs, stringifyJson(meta)],
    );
  }

  async touchHostSession({ sessionId, hostId, nowMs, meta }) {
    await this.db.run(
      "UPDATE host_sessions SET status = ?, last_seen_at_ms = ?, meta_json = ? WHERE session_id = ? AND host_id = ?",
      ["connected", nowMs, stringifyJson(meta), sessionId, hostId],
    );
  }

  async endHostSession({ sessionId, hostId, nowMs }) {
    await this.db.run(
      "UPDATE host_sessions SET status = ?, last_seen_at_ms = ? WHERE session_id = ? AND host_id = ?",
      ["disconnected", nowMs, sessionId, hostId],
    );
  }

  async claimBootstrapToken({
    jti,
    hostId,
    hostName,
    tokenHash,
    expiresAtMs,
    claimId,
    deviceName,
    platform,
    devicePublicKey,
    nowMs,
  }) {
    return this.db.transaction(async (tx) => {
      const existing = await tx.get("SELECT status FROM bootstrap_tokens WHERE jti = ?", [jti]);
      if (existing) {
        return { status: "already_used" };
      }

      await tx.run(
        "INSERT INTO bootstrap_tokens (jti, host_id, host_name, token_hash, expires_at_ms, claim_id, status, claimed_at_ms, completed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [jti, hostId, hostName, tokenHash, expiresAtMs, claimId, "claimed", nowMs, null],
      );
      await tx.run(
        "INSERT INTO device_claims (claim_id, jti, host_id, device_name, platform, device_public_key, status, challenge, created_at_ms, decided_at_ms, completed_at_ms, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [claimId, jti, hostId, deviceName, platform, devicePublicKey, "pending_approval", null, nowMs, null, null, null],
      );
      return { status: "ok" };
    });
  }

  async getClaim(claimId) {
    return this.db.get(
      `SELECT device_claims.*, bootstrap_tokens.host_name
       FROM device_claims
       JOIN bootstrap_tokens ON bootstrap_tokens.claim_id = device_claims.claim_id
       WHERE device_claims.claim_id = ?`,
      [claimId],
    );
  }

  async approveClaim(claimId, challenge, nowMs) {
    await this.db.run(
      "UPDATE device_claims SET status = ?, challenge = ?, decided_at_ms = ? WHERE claim_id = ? AND status = ?",
      ["approved", challenge, nowMs, claimId, "pending_approval"],
    );
  }

  async rejectClaim(claimId, nowMs) {
    await this.db.run(
      "UPDATE device_claims SET status = ?, decided_at_ms = ? WHERE claim_id = ? AND status = ?",
      ["rejected", nowMs, claimId, "pending_approval"],
    );
  }

  async completeClaimRegistration({
    claimId,
    deviceId,
    nowMs,
    accessTokenId,
    accessTokenHash,
    accessExpiresAtMs,
    refreshTokenId,
    refreshTokenHash,
    refreshExpiresAtMs,
  }) {
    return this.db.transaction(async (tx) => {
      const claim = await tx.get(
        `SELECT device_claims.*, bootstrap_tokens.host_name
         FROM device_claims
         JOIN bootstrap_tokens ON bootstrap_tokens.claim_id = device_claims.claim_id
         WHERE device_claims.claim_id = ?`,
        [claimId],
      );
      if (!claim || claim.status !== "approved") {
        return null;
      }

      await tx.run(
        "INSERT INTO devices (device_id, host_id, device_name, platform, public_key, created_at_ms, revoked_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [deviceId, claim.host_id, claim.device_name, claim.platform, claim.device_public_key, nowMs, null],
      );
      await tx.run(
        "INSERT INTO access_tokens (access_token_id, device_id, host_id, token_hash, expires_at_ms, revoked_at_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [accessTokenId, deviceId, claim.host_id, accessTokenHash, accessExpiresAtMs, null, nowMs],
      );
      await tx.run(
        "INSERT INTO refresh_tokens (refresh_token_id, device_id, host_id, token_hash, expires_at_ms, status, rotated_from_id, created_at_ms, revoked_at_ms, last_used_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [refreshTokenId, deviceId, claim.host_id, refreshTokenHash, refreshExpiresAtMs, "active", null, nowMs, null, nowMs],
      );
      await tx.run(
        "UPDATE device_claims SET status = ?, completed_at_ms = ?, device_id = ? WHERE claim_id = ?",
        ["completed", nowMs, deviceId, claimId],
      );
      await tx.run(
        "UPDATE bootstrap_tokens SET status = ?, completed_at_ms = ? WHERE claim_id = ?",
        ["completed", nowMs, claimId],
      );
      return claim;
    });
  }

  async findAccessToken(tokenHash) {
    return this.db.get(
      `SELECT access_tokens.*, devices.revoked_at_ms AS device_revoked_at_ms, devices.device_name, devices.platform, hosts.host_name
       FROM access_tokens
       JOIN devices ON devices.device_id = access_tokens.device_id
       JOIN hosts ON hosts.host_id = access_tokens.host_id
       WHERE access_tokens.token_hash = ?`,
      [tokenHash],
    );
  }

  async findRefreshToken(tokenHash) {
    return this.db.get(
      `SELECT refresh_tokens.*, devices.revoked_at_ms AS device_revoked_at_ms, devices.device_name, devices.platform, hosts.host_name
       FROM refresh_tokens
       JOIN devices ON devices.device_id = refresh_tokens.device_id
       JOIN hosts ON hosts.host_id = refresh_tokens.host_id
       WHERE refresh_tokens.token_hash = ?`,
      [tokenHash],
    );
  }

  async rotateRefreshToken({
    currentRefreshTokenId,
    deviceId,
    hostId,
    nowMs,
    accessTokenId,
    accessTokenHash,
    accessExpiresAtMs,
    refreshTokenId,
    refreshTokenHash,
    refreshExpiresAtMs,
  }) {
    return this.db.transaction(async (tx) => {
      const current = await tx.get("SELECT * FROM refresh_tokens WHERE refresh_token_id = ?", [currentRefreshTokenId]);
      if (!current || current.status !== "active") {
        return false;
      }

      await tx.run(
        "UPDATE refresh_tokens SET status = ?, last_used_at_ms = ? WHERE refresh_token_id = ?",
        ["rotated", nowMs, currentRefreshTokenId],
      );
      await tx.run(
        "INSERT INTO access_tokens (access_token_id, device_id, host_id, token_hash, expires_at_ms, revoked_at_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [accessTokenId, deviceId, hostId, accessTokenHash, accessExpiresAtMs, null, nowMs],
      );
      await tx.run(
        "INSERT INTO refresh_tokens (refresh_token_id, device_id, host_id, token_hash, expires_at_ms, status, rotated_from_id, created_at_ms, revoked_at_ms, last_used_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [refreshTokenId, deviceId, hostId, refreshTokenHash, refreshExpiresAtMs, "active", currentRefreshTokenId, nowMs, null, nowMs],
      );
      return true;
    });
  }

  async revokeDevice(deviceId, nowMs) {
    await this.db.transaction(async (tx) => {
      await tx.run("UPDATE devices SET revoked_at_ms = ? WHERE device_id = ?", [nowMs, deviceId]);
      await tx.run("UPDATE access_tokens SET revoked_at_ms = ? WHERE device_id = ? AND revoked_at_ms IS NULL", [
        nowMs,
        deviceId,
      ]);
      await tx.run(
        "UPDATE refresh_tokens SET status = ?, revoked_at_ms = ? WHERE device_id = ? AND revoked_at_ms IS NULL",
        ["revoked", nowMs, deviceId],
      );
    });
  }

  async listDevices(hostId) {
    return this.db.all(
      "SELECT device_id, device_name, platform, created_at_ms, revoked_at_ms FROM devices WHERE host_id = ? ORDER BY created_at_ms DESC",
      [hostId],
    );
  }

  async getHostForDevice(deviceId) {
    return this.db.get(
      `SELECT hosts.*
       FROM devices
       JOIN hosts ON hosts.host_id = devices.host_id
       WHERE devices.device_id = ?`,
      [deviceId],
    );
  }

  async appendAuditEvent({ auditEventId, hostId, deviceId, eventType, metadata, nowMs }) {
    await this.db.run(
      "INSERT INTO audit_events (audit_event_id, host_id, device_id, event_type, metadata_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
      [auditEventId, hostId || null, deviceId || null, eventType, stringifyJson(metadata), nowMs],
    );
  }
}

export function createRelayStore(config) {
  const adapter =
    config.database.kind === "postgres"
      ? new PgAdapter(config.database.databaseUrl)
      : new SqliteAdapter(config.database.sqlitePath);
  return new RelayStore(adapter);
}
