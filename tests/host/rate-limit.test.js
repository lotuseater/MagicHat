import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntime, pairDevice } from "./_helpers.js";
import { CliInstancesManager } from "../../host/src/operations/cliInstancesManager.js";

function neverSpawningManager() {
  // The launch path never actually fires because the limiter rejects before
  // reaching the CLI manager in these tests, but CliInstancesManager's
  // constructor expects a spawn implementation.
  return new CliInstancesManager({
    spawnImpl: vi.fn(() => ({
      on: vi.fn(),
      kill: vi.fn(),
      stdin: { write: vi.fn(), destroyed: false, writableEnded: false },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      pid: 1,
    })),
    ptySpawnImpl: null,
    now: () => 1_000,
  });
}

describe("host-side rate limiter on /v1 mutating routes", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length) {
      await contexts.pop().cleanup();
    }
  });

  it("returns 429 once the configured burst budget is exhausted", async () => {
    const ctx = await createRuntime({
      cliInstancesManager: neverSpawningManager(),
      // 3 mutations allowed per 60 s; 4th must be rejected.
      rateLimit: { mutationLimit: 3, mutationWindowMs: 60_000 },
    });
    contexts.push(ctx);
    const token = await pairDevice(ctx);

    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await ctx.http.post("/v1/cli-instances", {
        token,
        body: { preset: "claude", initial_prompt: `unique-${i}` },
      });
      statuses.push(response.status);
    }

    // First three succeed (201) or fail for other reasons, but the 4th must be 429.
    expect(statuses[statuses.length - 1]).toBe(429);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
  });

  it("does not rate-limit GET requests against the same budget", async () => {
    const ctx = await createRuntime({
      cliInstancesManager: neverSpawningManager(),
      rateLimit: { mutationLimit: 1, mutationWindowMs: 60_000 },
    });
    contexts.push(ctx);
    const token = await pairDevice(ctx);

    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await ctx.http.get("/v1/cli-instances/presets", { token });
      expect(response.status).toBe(200);
    }
  });

  it("buckets requests per device so one device can't starve another", async () => {
    const ctx = await createRuntime({
      cliInstancesManager: neverSpawningManager(),
      rateLimit: { mutationLimit: 2, mutationWindowMs: 60_000 },
    });
    contexts.push(ctx);

    const tokenA = await pairDevice(ctx, "device-a");
    const tokenB = await pairDevice(ctx, "device-b");

    // Exhaust A's budget.
    for (let i = 0; i < 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.http.post("/v1/cli-instances", {
        token: tokenA,
        body: { preset: "claude", initial_prompt: `a-${i}` },
      });
    }
    const thirdFromA = await ctx.http.post("/v1/cli-instances", {
      token: tokenA,
      body: { preset: "claude", initial_prompt: "a-overflow" },
    });
    expect(thirdFromA.status).toBe(429);

    // B still has a fresh bucket.
    const firstFromB = await ctx.http.post("/v1/cli-instances", {
      token: tokenB,
      body: { preset: "claude", initial_prompt: "b-first" },
    });
    expect(firstFromB.status).not.toBe(429);
  });
});
