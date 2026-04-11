import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBeaconEntry, createRuntime, createWorkspace, pairDevice, writeBeacon } from "./_helpers.js";

describe("restore after host restart", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      await contexts.pop().cleanup();
    }
  });

  it("keeps paired token valid after process restart", async () => {
    const workspace = await createWorkspace();
    const instance = buildBeaconEntry({ pid: 311 });
    await writeBeacon(workspace.beaconPath, [instance]);

    const first = await createRuntime({
      workspace,
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand: vi.fn(async () => ({ status: "ok" })),
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
    });
    contexts.push(first);

    const token = await pairDevice(first, "android-main");
    expect(token).toBeTruthy();

    const sendCommand = vi.fn(async (_instance, payload) => ({
      status: "ok",
      cmd: payload.cmd,
    }));

    const second = await createRuntime({
      workspace,
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand,
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
    });
    contexts.push(second);

    const restoreResponse = await second.http.post("/v1/instances/311/restore", {
      token,
      body: { restore_state_path: "C:/tmp/session_restore.json" },
    });

    expect(restoreResponse.status).toBe(202);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand.mock.calls[0][1].cmd).toBe("restore_session");
  });
});
