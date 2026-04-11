import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBeaconEntry, createRuntime, pairDevice } from "./_helpers.js";

const activePid = 101;

describe("pairing and auth", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      const ctx = contexts.pop();
      await ctx.cleanup();
    }
  });

  it("rejects unauthenticated access", async () => {
    const ctx = await createRuntime({
      beaconEntries: [buildBeaconEntry({ pid: activePid })],
      processProbe: vi.fn((pid) => pid === activePid),
    });
    contexts.push(ctx);

    const response = await ctx.http.get("/v1/instances");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("unauthorized");
  });

  it("pairs with one-time code and returns bearer token", async () => {
    const ctx = await createRuntime({
      beaconEntries: [buildBeaconEntry({ pid: activePid })],
      processProbe: vi.fn((pid) => pid === activePid),
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx, "pixel-9");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);

    const listResponse = await ctx.http.get("/v1/instances", { token });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.instances)).toBe(true);
    expect(listResponse.body.instances[0].pid).toBe(activePid);
  });

  it("invalid pairing code is rejected", async () => {
    const ctx = await createRuntime({
      beaconEntries: [buildBeaconEntry({ pid: activePid })],
      processProbe: vi.fn((pid) => pid === activePid),
    });
    contexts.push(ctx);

    const bad = await ctx.http.post("/v1/pairing/session", {
      body: {
        pairing_code: "000000",
        device_name: "android",
      },
    });

    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("unauthorized");
  });
});
