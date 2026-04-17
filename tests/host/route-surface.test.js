import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBeaconEntry, createRuntime, pairDevice } from "./_helpers.js";

describe("contract route surface", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      await contexts.pop().cleanup();
    }
  });

  it("serves host metadata and instance lifecycle routes", async () => {
    const sendCommand = vi.fn(async (_instance, payload) => ({
      status: "ok",
      cmd: payload.cmd,
      snapshot: { phase: "running" },
    }));

    const closeInstance = vi.fn(async (instance) => ({
      pid: instance.pid,
      closed: true,
      graceful: true,
    }));

    const ctx = await createRuntime({
      beaconEntries: [buildBeaconEntry({ pid: 412 })],
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok", snapshot: { phase: "running" } })),
        sendCommand,
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999 })),
        closeInstance,
      },
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);

    const host = await ctx.http.get("/v1/host", { token });
    expect(host.status).toBe(200);
    expect(host.body.scope).toBe("lan_only_v1");

    const launch = await ctx.http.post("/v1/instances", {
      token,
      body: {
        startup_timeout_ms: 1200,
        team_mode: "full",
        launcher_preset: "codex",
        fenrus_launcher: "default",
      },
    });
    expect(launch.status).toBe(201);
    expect(launch.body.pid).toBe(999);
    expect(ctx.runtime.lifecycleManager.launchInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        startupTimeoutMs: 1200,
        startupProfile: {
          team_mode: "full",
          launcher_preset: "codex",
          fenrus_launcher: "default",
        },
      }),
    );

    const poll = await ctx.http.get("/v1/instances/412/poll", { token });
    expect(poll.status).toBe(200);
    expect(poll.body.pid).toBe(412);

    const close = await ctx.http.request("DELETE", "/v1/instances/412", { token });
    expect(close.status).toBe(202);
    expect(close.body.status).toBe("queued");

    expect(sendCommand.mock.calls.find((call) => call[1].cmd === "close_instance")).toBeTruthy();
    expect(closeInstance).toHaveBeenCalledTimes(1);
  });
});
