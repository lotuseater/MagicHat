import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntime, pairDevice } from "./_helpers.js";

describe("pairing code auto-rotation", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length) {
      await contexts.pop().cleanup();
    }
  });

  it("rotates the pairing code after a successful pair so a second device can still pair", async () => {
    const ctx = await createRuntime({});
    contexts.push(ctx);

    const firstCode = ctx.runtime.pairingManager.getActivePairingCode().code;
    await pairDevice(ctx, "first-device");

    const secondCode = ctx.runtime.pairingManager.getActivePairingCode().code;
    // After a successful pair the manager must have minted a fresh code —
    // not sit with `active_pairing = null` until server restart.
    expect(secondCode).toBeTruthy();
    expect(secondCode).not.toBe(firstCode);

    // And a second device can pair with the freshly-issued code.
    const token = await pairDevice(ctx, "second-device");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });

  it("emits pairing_code_issued when the code rotates", async () => {
    const ctx = await createRuntime({});
    contexts.push(ctx);

    const events = [];
    ctx.runtime.pairingManager.on("pairing_code_issued", (pairing) => {
      events.push(pairing);
    });

    await pairDevice(ctx, "rotating-device");

    expect(events).toHaveLength(1);
    expect(events[0].code).toBeTruthy();
    expect(events[0].expires_at_ms).toBeGreaterThan(Date.now());
  });

  it("rejects reuse of a code that was already consumed", async () => {
    const ctx = await createRuntime({});
    contexts.push(ctx);

    const firstCode = ctx.runtime.pairingManager.getActivePairingCode().code;
    await pairDevice(ctx, "first-device");

    // Re-using the first (already-consumed) code should fail cleanly.
    const attempt = await ctx.http.post("/v1/pairing/session", {
      body: { pairing_code: firstCode, device_name: "replay" },
    });
    expect(attempt.status).toBe(401);
    expect(attempt.body.error).toBe("unauthorized");
  });

  it("exposes removePairedDevice so an operator can revoke a token", async () => {
    const ctx = await createRuntime({});
    contexts.push(ctx);

    const token = await pairDevice(ctx, "to-be-revoked");
    const authed = await ctx.http.get("/v1/host", { token });
    expect(authed.status).toBe(200);

    const removed = ctx.runtime.pairingManager.removePairedDevice({ token });
    expect(removed).toBe(true);

    const afterRevoke = await ctx.http.get("/v1/host", { token });
    expect(afterRevoke.status).toBe(401);
  });
});
