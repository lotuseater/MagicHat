import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBeaconEntry, createRuntime, pairDevice } from "./_helpers.js";

describe("endpoint command mapping", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      await contexts.pop().cleanup();
    }
  });

  it("maps prompt and restore endpoints to existing Team App IPC commands", async () => {
    const sendCommand = vi.fn(async (_instance, payload) => ({
      status: "ok",
      seq: 11,
      cmd: payload.cmd,
    }));

    const ctx = await createRuntime({
      beaconEntries: [buildBeaconEntry({ pid: 412 })],
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand,
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999 })),
        closeInstance: vi.fn(async () => ({ pid: 412, closed: true, graceful: true })),
      },
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);

    const initial = await ctx.http.post("/v1/instances/412/prompt", {
      token,
      body: { prompt: "Build status update" },
    });
    expect(initial.status).toBe(202);

    const follow = await ctx.http.post("/v1/instances/412/follow-up", {
      token,
      body: { message: "Continue with QA" },
    });
    expect(follow.status).toBe(202);

    const restore = await ctx.http.post("/v1/instances/412/restore", {
      token,
      body: { restore_state_path: "C:/tmp/session_restore.json" },
    });
    expect(restore.status).toBe(202);

    expect(sendCommand.mock.calls[0][1].cmd).toBe("submit_initial_prompt");
    expect(sendCommand.mock.calls[1][1].cmd).toBe("submit_follow_up");
    expect(sendCommand.mock.calls[2][1].cmd).toBe("restore_session");
  });
});
