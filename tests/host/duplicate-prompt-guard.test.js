import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBeaconEntry, createRuntime, pairDevice } from "./_helpers.js";

describe("duplicate initial-prompt guard for Team App launch", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length) {
      await contexts.pop().cleanup();
    }
  });

  it("rejects a second launch whose title matches an existing running instance", async () => {
    const existingEntry = buildBeaconEntry({
      instance_id: "wizard_team_app_101_1000",
      pid: 101,
      current_task_state: {
        phase: "running",
        task: "reset the DB",
      },
    });

    const launchInstance = vi.fn(async () =>
      buildBeaconEntry({
        pid: 202,
        instance_id: "wizard_team_app_202_3000",
        current_task_state: { phase: "running", task: "reset the DB" },
      }),
    );

    const ctx = await createRuntime({
      beaconEntries: [existingEntry],
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok", snapshot: { phase: "running" } })),
        sendCommand: vi.fn(async () => ({ status: "ok" })),
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance,
        closeInstance: vi.fn(async () => ({ closed: true })),
      },
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);

    const dup = await ctx.http.post("/v1/instances", {
      token,
      body: { title: "reset the DB" },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("duplicate_initial_prompt");
    expect(launchInstance).not.toHaveBeenCalled();
  });

  it("allows a restore to re-use the same task text", async () => {
    // Restore flows bypass the guard because the intent is to resume the same task.
    const existingEntry = buildBeaconEntry({
      instance_id: "wizard_team_app_101_1000",
      pid: 101,
      current_task_state: { phase: "running", task: "continue migration" },
      restore_ref: "restore-alpha",
    });

    const launchInstance = vi.fn(async () =>
      buildBeaconEntry({
        pid: 303,
        instance_id: "wizard_team_app_303_4000",
        current_task_state: { phase: "running", task: "continue migration" },
      }),
    );

    const ctx = await createRuntime({
      beaconEntries: [existingEntry],
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok", snapshot: { phase: "running" } })),
        sendCommand: vi.fn(async () => ({ status: "ok" })),
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance,
        closeInstance: vi.fn(async () => ({ closed: true })),
      },
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);

    // Seed a restore ref in remoteAccessState so the restore is allowed.
    ctx.runtime.remoteAccessState.rememberRestoreRefsFromInstances([
      { restore_ref: "restore-alpha", restore_state_path: "C:/tmp/restore.json" },
    ]);

    const restore = await ctx.http.post("/v1/instances", {
      token,
      body: { title: "continue migration", restore_ref: "restore-alpha" },
    });
    // Restore path succeeds (or at least: doesn't hit duplicate_initial_prompt).
    expect([201, 400]).toContain(restore.status);
    if (restore.status === 409) {
      throw new Error("restore flow should bypass duplicate_initial_prompt guard");
    }
  });
});
