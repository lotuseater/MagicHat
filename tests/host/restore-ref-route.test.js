import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBeaconEntry, createRuntime, pairDevice } from "./_helpers.js";

describe("restore ref routes", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      await contexts.pop().cleanup();
    }
  });

  it("lists known restore refs for authenticated LAN clients", async () => {
    const ctx = await createRuntime({
      beaconEntries: [
        buildBeaconEntry({
          pid: 412,
          session_id: "session-alpha",
          restore_state_path: "C:/runs/session-alpha/session_restore.json",
          current_task_state: {
            phase: "running",
            task: "Restore Alpha",
          },
        }),
      ],
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand: vi.fn(async () => ({ status: "ok" })),
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);
    const response = await ctx.http.get("/v1/restore-refs", { token });

    expect(response.status).toBe(200);
    expect(response.body.restore_refs).toHaveLength(1);
    expect(response.body.restore_refs[0]).toMatchObject({
      session_id: "session-alpha",
      title: "Restore Alpha",
    });
    expect(response.body.restore_refs[0].restore_ref).toMatch(/^restore_/);
  });

  it("launches a restored instance by restore_ref without exposing restore paths", async () => {
    const sendCommand = vi.fn(async (_instance, payload) => ({
      status: "ok",
      cmd: payload.cmd,
    }));

    const ctx = await createRuntime({
      beaconEntries: [
        buildBeaconEntry({
          pid: 412,
          session_id: "session-alpha",
          restore_state_path: "C:/runs/session-alpha/session_restore.json",
          current_task_state: {
            phase: "running",
            task: "Restore Alpha",
          },
        }),
      ],
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand,
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () =>
          buildBeaconEntry({
            pid: 999,
            instance_id: "wizard_team_app_999_9990",
            session_id: "session-restored",
            restore_state_path: "C:/runs/session-restored/session_restore.json",
          })
        ),
        closeInstance: vi.fn(async () => ({ closed: true, graceful: true })),
      },
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);
    const restoreRefs = await ctx.http.get("/v1/restore-refs", { token });
    const restoreRef = restoreRefs.body.restore_refs[0].restore_ref;

    const launched = await ctx.http.post("/v1/instances", {
      token,
      body: { restore_ref: restoreRef },
    });

    expect(launched.status).toBe(201);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand.mock.calls[0][1]).toMatchObject({
      cmd: "restore_session",
      path: "C:/runs/session-alpha/session_restore.json",
    });
  });
});
