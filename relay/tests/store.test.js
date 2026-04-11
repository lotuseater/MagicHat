import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRelayStore } from "../src/store.js";

describe("relay store", () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()();
    }
  });

  it("marks bootstrap tokens single-use and rotates refresh tokens", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-store-"));
    const store = createRelayStore({
      database: {
        kind: "sqlite",
        sqlitePath: path.join(root, "relay.sqlite"),
      },
    });
    await store.init();
    cleanups.push(async () => {
      await store.close();
      await fs.rm(root, { recursive: true, force: true });
    });

    await store.upsertHost({
      hostId: "host_test",
      hostName: "Office PC",
      publicKey: "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----",
      fingerprint: "sha256:test",
      nowMs: Date.now(),
    });

    const firstClaim = await store.claimBootstrapToken({
      jti: "bt_test",
      hostId: "host_test",
      hostName: "Office PC",
      tokenHash: "tok-hash",
      expiresAtMs: Date.now() + 60_000,
      claimId: "claim_1",
      deviceName: "Pixel",
      platform: "android",
      devicePublicKey: "pub",
      nowMs: Date.now(),
    });
    expect(firstClaim.status).toBe("ok");

    const secondClaim = await store.claimBootstrapToken({
      jti: "bt_test",
      hostId: "host_test",
      hostName: "Office PC",
      tokenHash: "tok-hash",
      expiresAtMs: Date.now() + 60_000,
      claimId: "claim_2",
      deviceName: "Pixel",
      platform: "android",
      devicePublicKey: "pub",
      nowMs: Date.now(),
    });
    expect(secondClaim.status).toBe("already_used");

    await store.approveClaim("claim_1", "challenge-1", Date.now());
    const claim = await store.completeClaimRegistration({
      claimId: "claim_1",
      deviceId: "device_1",
      nowMs: Date.now(),
      accessTokenId: "access_1",
      accessTokenHash: "access-hash-1",
      accessExpiresAtMs: Date.now() + 60_000,
      refreshTokenId: "refresh_1",
      refreshTokenHash: "refresh-hash-1",
      refreshExpiresAtMs: Date.now() + 60_000,
    });
    expect(claim.host_id).toBe("host_test");

    const rotated = await store.rotateRefreshToken({
      currentRefreshTokenId: "refresh_1",
      deviceId: "device_1",
      hostId: "host_test",
      nowMs: Date.now(),
      accessTokenId: "access_2",
      accessTokenHash: "access-hash-2",
      accessExpiresAtMs: Date.now() + 60_000,
      refreshTokenId: "refresh_2",
      refreshTokenHash: "refresh-hash-2",
      refreshExpiresAtMs: Date.now() + 60_000,
    });
    expect(rotated).toBe(true);

    const oldRefresh = await store.findRefreshToken("refresh-hash-1");
    const newRefresh = await store.findRefreshToken("refresh-hash-2");
    expect(oldRefresh.status).toBe("rotated");
    expect(newRefresh.status).toBe("active");
  });
});
