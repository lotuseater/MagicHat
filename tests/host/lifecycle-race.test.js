import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  it("fails launch when the startup task is rejected by Team App IPC", async () => {
    const manager = new LifecycleManager({
      beaconStore: {
        listInternalInstances: vi.fn(async () => [{ pid: 700 }]),
        waitForNewInstance: vi.fn(async () => ({ pid: 701, instance_id: "wizard_team_app_701_1000", cmd_path: "cmd", resp_path: "resp" })),
        pruneStaleEntries: vi.fn(async () => ({})),
      },
      ipcClient: {
        sendCommand: vi.fn(async () => {
          const error = new Error("submit_initial_prompt is not implemented");
          error.code = "not_supported";
          throw error;
        }),
      },
      processController: {
        launch: vi.fn(),
        closeGracefully: vi.fn(async () => true),
        forceKill: vi.fn(async () => true),
      },
      launchConfig: { command: "team-app.exe", args: [], waitMs: 200 },
    });

    await expect(manager.launchInstance({ task: "task-1" })).rejects.toMatchObject({
      code: "not_supported",
      message: "submit_initial_prompt is not implemented",
    });
  });

  it("launches mac instances with dedicated automation artifacts", async () => {
    const launch = vi.fn();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-launch-"));
    const manager = new LifecycleManager({
      beaconStore: {
        listInternalInstances: vi.fn(async () => []),
        waitForNewInstance: vi.fn(async () => ({
          pid: 701,
          instance_id: "wizard_team_app_701_1000",
          cmd_path: "cmd",
          resp_path: "resp",
        })),
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
      launchConfig: {
        command: "/Applications/Wizard Team App.app/Contents/MacOS/wizard_team_app",
        args: [],
        cwd: "/workspace",
        waitMs: 200,
        automationPrefixBase: "magichat_team_app",
        automationTempRoot: path.join(root, "transient"),
        runArtifactRoot: path.join(root, "runs"),
        noActivate: true,
        headlessPrompts: true,
        keepAutomationArtifacts: true,
      },
    });

    await manager.launchInstance();

    expect(launch).toHaveBeenCalledTimes(1);
    const launchConfig = launch.mock.calls[0][0];
    expect(launchConfig.env.WIZARD_TEAM_APP_AUTOMATION_PREFIX).toMatch(/^magichat_team_app_/);
    expect(launchConfig.env.WIZARD_TEAM_APP_HEADLESS_PROMPTS).toBe("1");
    expect(launchConfig.env.WIZARD_TEAM_APP_NO_ACTIVATE).toBe("1");
    expect(launchConfig.env.WIZARD_TEAM_APP_KEEP_AUTOMATION_ARTIFACTS).toBe("1");
    expect(launchConfig.env.WIZARD_TEAM_APP_TEMP_DIR).toContain(path.join(root, "transient"));
    expect(launchConfig.env.WIZARD_TEAM_APP_RUN_ARTIFACT_DIR).toContain(path.join(root, "runs"));
    expect(launchConfig.env.WIZARD_TEAM_APP_RUN_ARTIFACT_ROOT).toBe(path.join(root, "runs"));
    await fs.access(launchConfig.env.WIZARD_TEAM_APP_TEMP_DIR);
    await fs.access(launchConfig.env.WIZARD_TEAM_APP_RUN_ARTIFACT_DIR);
  });

  it("applies team mode and launchers through Team App combo automation", async () => {
    const sendCommand = vi.fn(async () => ({ status: "ok" }));
    const manager = new LifecycleManager({
      beaconStore: {
        listInternalInstances: vi.fn(async () => []),
        waitForNewInstance: vi.fn(async () => ({
          pid: 701,
          instance_id: "wizard_team_app_701_1000",
          cmd_path: "cmd",
          resp_path: "resp",
        })),
        pruneStaleEntries: vi.fn(async () => ({})),
      },
      ipcClient: {
        sendCommand,
      },
      processController: {
        launch: vi.fn(),
        closeGracefully: vi.fn(async () => true),
        forceKill: vi.fn(async () => true),
      },
      launchConfig: { command: "team-app.exe", args: [], waitMs: 200 },
    });

    await manager.launchInstance({
      task: "Hej",
      startupProfile: {
        team_mode: "simple",
        launcher_preset: "codex",
        fenrus_launcher: "codex",
      },
    });

    const cmdsOf = (name) =>
      sendCommand.mock.calls
        .map(([, payload]) => payload)
        .filter((payload) => payload.cmd === name);

    // Direct-state profile write is sent before UI combo selection so the
    // Team App applies the selection even if the UI is still settling.
    const profileCalls = cmdsOf("set_startup_profile");
    expect(profileCalls.length).toBeGreaterThanOrEqual(2);
    expect(profileCalls[0]).toMatchObject({
      team_mode: "simple",
      launcher_preset: "codex",
    });
    expect(profileCalls.some((p) => p.fenrus_launcher === "codex")).toBe(true);

    expect(cmdsOf("ui_select_combo")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ control: "team_mode", index: 1 }),
        expect.objectContaining({ control: "launcher", index: 1 }),
        expect.objectContaining({ control: "fenrus_launcher", index: 2 }),
      ]),
    );

    expect(cmdsOf("submit_initial_prompt")).toEqual([
      expect.objectContaining({ prompt: "Hej" }),
    ]);
  });

  it("falls back to set_startup_profile for unsupported fenrus presets", async () => {
    const sendCommand = vi.fn(async () => ({ status: "ok" }));
    const manager = new LifecycleManager({
      beaconStore: {
        listInternalInstances: vi.fn(async () => []),
        waitForNewInstance: vi.fn(async () => ({
          pid: 701,
          instance_id: "wizard_team_app_701_1000",
          cmd_path: "cmd",
          resp_path: "resp",
        })),
        pruneStaleEntries: vi.fn(async () => ({})),
      },
      ipcClient: {
        sendCommand,
      },
      processController: {
        launch: vi.fn(),
        closeGracefully: vi.fn(async () => true),
        forceKill: vi.fn(async () => true),
      },
      launchConfig: { command: "team-app.exe", args: [], waitMs: 200 },
    });

    await manager.launchInstance({
      startupProfile: {
        fenrus_launcher: "future-launcher",
      },
    });

    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 701 }),
      expect.objectContaining({
        cmd: "set_startup_profile",
        fenrus_launcher: "future-launcher",
      }),
      expect.objectContaining({ requireOk: true }),
    );
  });

  it("falls back to set_startup_profile for unsupported shared startup fields", async () => {
    const sendCommand = vi.fn(async () => ({ status: "ok" }));
    const manager = new LifecycleManager({
      beaconStore: {
        listInternalInstances: vi.fn(async () => []),
        waitForNewInstance: vi.fn(async () => ({
          pid: 701,
          instance_id: "wizard_team_app_701_1000",
          cmd_path: "cmd",
          resp_path: "resp",
        })),
        pruneStaleEntries: vi.fn(async () => ({})),
      },
      ipcClient: {
        sendCommand,
      },
      processController: {
        launch: vi.fn(),
        closeGracefully: vi.fn(async () => true),
        forceKill: vi.fn(async () => true),
      },
      launchConfig: { command: "team-app.exe", args: [], waitMs: 200 },
    });

    await manager.launchInstance({
      startupProfile: {
        team_mode: "future-mode",
        launcher_preset: "future-launcher",
      },
    });

    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 701 }),
      expect.objectContaining({
        cmd: "set_startup_profile",
        team_mode: "future-mode",
        launcher_preset: "future-launcher",
      }),
      expect.objectContaining({ requireOk: true }),
    );
  });
});
