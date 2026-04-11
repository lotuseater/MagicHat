import { describe, expect, it, vi } from "vitest";
import { LifecycleManager } from "../../host/src/lifecycle/lifecycleManager.js";

describe("instance launch/close race", () => {
  it("coalesces concurrent launch requests", async () => {
    const launch = vi.fn();
    const waitForNewInstance = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { pid: 701, cmd_path: "cmd", resp_path: "resp" };
    });

    const manager = new LifecycleManager({
      beaconStore: {
        listInternalInstances: vi.fn(async () => [{ pid: 700 }]),
        waitForNewInstance,
        pruneStaleEntries: vi.fn(async () => ({})),
      },
      ipcClient: {
        sendCommand: vi.fn(async () => ({ status: "ok" })),
      },
      processController: {
        launch,
        closeGracefully: vi.fn(async () => true),
        forceKill: vi.fn(async () => true),
      },
      launchConfig: { command: "team-app.exe", args: [], waitMs: 200 },
    });

    const [a, b] = await Promise.all([
      manager.launchInstance({ task: "task-1" }),
      manager.launchInstance({ task: "task-1" }),
    ]);

    expect(a.pid).toBe(701);
    expect(b.pid).toBe(701);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(waitForNewInstance).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent close requests for the same pid", async () => {
    const closeGracefully = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return true;
    });

    const manager = new LifecycleManager({
      beaconStore: {
        listInternalInstances: vi.fn(async () => []),
        waitForNewInstance: vi.fn(async () => null),
        pruneStaleEntries: vi.fn(async () => ({})),
      },
      ipcClient: {
        sendCommand: vi.fn(async () => ({ status: "ok" })),
      },
      processController: {
        launch: vi.fn(),
        closeGracefully,
        forceKill: vi.fn(async () => true),
      },
      launchConfig: { command: "team-app.exe", args: [], waitMs: 200 },
    });

    const instance = { pid: 888 };
    const [first, second] = await Promise.all([
      manager.closeInstance(instance),
      manager.closeInstance(instance),
    ]);

    expect(closeGracefully).toHaveBeenCalledTimes(1);
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(true);
  });
});
