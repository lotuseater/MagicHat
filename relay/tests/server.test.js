import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startRelayServer } from "../src/server.js";

describe("relay server startup", () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()();
    }
  });

  it("allows loopback http without explicit insecure override", async () => {
    const relayRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-start-"));
    const relay = await startRelayServer({
      config: {
        listenHost: "127.0.0.1",
        port: 0,
        allowInsecureHttp: false,
        database: {
          kind: "sqlite",
          sqlitePath: path.join(relayRoot, "relay.sqlite"),
        },
        accessTokenTtlMs: 15 * 60 * 1000,
        refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
        bootstrapTokenTtlMs: 10 * 60 * 1000,
        heartbeatTimeoutMs: 60 * 1000,
        requestTimeoutMs: 5000,
        rateLimitWindowMs: 60 * 1000,
        bootstrapClaimLimit: 20,
        refreshLimit: 60,
        commandLimit: 120,
        tls: {
          certPath: "",
          keyPath: "",
        },
      },
    });
    cleanups.push(async () => {
      await relay.close();
      await fs.rm(relayRoot, { recursive: true, force: true });
    });

    expect(relay.scheme).toBe("http");
    expect(relay.server.address().port).toBeGreaterThan(0);
  });

  it("rejects non-loopback http without tls or explicit insecure override", async () => {
    const relayRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-start-"));
    cleanups.push(async () => {
      await fs.rm(relayRoot, { recursive: true, force: true });
    });

    await expect(
      startRelayServer({
        config: {
          listenHost: "0.0.0.0",
          port: 0,
          allowInsecureHttp: false,
          database: {
            kind: "sqlite",
            sqlitePath: path.join(relayRoot, "relay.sqlite"),
          },
          accessTokenTtlMs: 15 * 60 * 1000,
          refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
          bootstrapTokenTtlMs: 10 * 60 * 1000,
          heartbeatTimeoutMs: 60 * 1000,
          requestTimeoutMs: 5000,
          rateLimitWindowMs: 60 * 1000,
          bootstrapClaimLimit: 20,
          refreshLimit: 60,
          commandLimit: 120,
          tls: {
            certPath: "",
            keyPath: "",
          },
        },
      }),
    ).rejects.toThrow("relay_tls_required");
  });
});
