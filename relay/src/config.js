import os from "node:os";
import path from "node:path";

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readRelayConfig(env = process.env) {
  const tempRoot = env.TEMP || env.TMP || os.tmpdir();
  const sqlitePath =
    env.MAGICHAT_RELAY_SQLITE_PATH ||
    path.join(tempRoot, "wizard_team_app", "magichat_relay.sqlite");
  const databaseUrl = env.MAGICHAT_RELAY_DATABASE_URL || "";
  const tlsCertPath = env.MAGICHAT_RELAY_TLS_CERT_PATH || "";
  const tlsKeyPath = env.MAGICHAT_RELAY_TLS_KEY_PATH || "";
  const certificatePinsetVersion = env.MAGICHAT_RELAY_CERTIFICATE_PINSET_VERSION || "dev-insecure";

  return {
    listenHost: env.MAGICHAT_RELAY_BIND_HOST || "127.0.0.1",
    port: parsePositiveInt(env.MAGICHAT_RELAY_PORT, 18795),
    allowInsecureHttp: env.MAGICHAT_RELAY_ALLOW_INSECURE_HTTP === "1",
    database: {
      kind: databaseUrl ? "postgres" : "sqlite",
      databaseUrl,
      sqlitePath,
    },
    accessTokenTtlMs: parsePositiveInt(env.MAGICHAT_RELAY_ACCESS_TOKEN_TTL_MS, 15 * 60 * 1000),
    refreshTokenTtlMs: parsePositiveInt(env.MAGICHAT_RELAY_REFRESH_TOKEN_TTL_MS, 30 * 24 * 60 * 60 * 1000),
    bootstrapTokenTtlMs: parsePositiveInt(env.MAGICHAT_RELAY_BOOTSTRAP_TTL_MS, 10 * 60 * 1000),
    heartbeatTimeoutMs: parsePositiveInt(env.MAGICHAT_RELAY_HEARTBEAT_TIMEOUT_MS, 60 * 1000),
    requestTimeoutMs: parsePositiveInt(env.MAGICHAT_RELAY_REQUEST_TIMEOUT_MS, 20 * 1000),
    rateLimitWindowMs: parsePositiveInt(env.MAGICHAT_RELAY_RATE_LIMIT_WINDOW_MS, 60 * 1000),
    bootstrapClaimLimit: parsePositiveInt(env.MAGICHAT_RELAY_BOOTSTRAP_LIMIT, 20),
    refreshLimit: parsePositiveInt(env.MAGICHAT_RELAY_REFRESH_LIMIT, 60),
    commandLimit: parsePositiveInt(env.MAGICHAT_RELAY_COMMAND_LIMIT, 120),
    tls: {
      certPath: tlsCertPath,
      keyPath: tlsKeyPath,
    },
    certificatePinsetVersion,
  };
}
