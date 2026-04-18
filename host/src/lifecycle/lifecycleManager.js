import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function launchToken(prefixBase = "magichat_team_app") {
  return `${prefixBase}_${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

const FENRUS_COMBO_INDEX_BY_PRESET = Object.freeze({
  default: 0,
  "claude-code": 1,
  codex: 2,
  "claude-legacy": 3,
  "custom-legacy": 4,
  gemini: 5,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LifecycleManager {
  constructor({ beaconStore, ipcClient, processController, launchConfig }) {
    this.beaconStore = beaconStore;
    this.ipcClient = ipcClient;
    this.processController = processController;
    this.launchConfig = launchConfig;

    this.launchInFlight = null;
    this.closeLocks = new Map();
  }

  async buildLaunchConfig() {
    const tempRoot = this.launchConfig.automationTempRoot ||
      path.join(os.tmpdir(), "wizard_team_app", "magichat", "transient");
    const runRoot = this.launchConfig.runArtifactRoot ||
      path.join(this.launchConfig.cwd || process.cwd(), ".magichat", "team_app_runs");
    const prefix = launchToken(this.launchConfig.automationPrefixBase);
    const artifactDir = path.join(tempRoot, prefix, "transient");
    const runDir = path.join(runRoot, prefix);

    await fs.mkdir(artifactDir, { recursive: true });
    await fs.mkdir(runDir, { recursive: true });
    await fs.mkdir(runRoot, { recursive: true });

    return {
      ...this.launchConfig,
      env: {
        ...(this.launchConfig.env || {}),
        WIZARD_TEAM_APP_AUTOMATION_PREFIX: prefix,
        WIZARD_TEAM_APP_HEADLESS_PROMPTS: this.launchConfig.headlessPrompts ? "1" : "0",
        WIZARD_TEAM_APP_NO_ACTIVATE: this.launchConfig.noActivate ? "1" : "0",
        WIZARD_TEAM_APP_KEEP_AUTOMATION_ARTIFACTS:
          this.launchConfig.keepAutomationArtifacts ? "1" : "0",
        WIZARD_TEAM_APP_TEMP_DIR: artifactDir,
        WIZARD_TEAM_APP_RUN_ARTIFACT_DIR: runDir,
        WIZARD_TEAM_APP_RUN_ARTIFACT_ROOT: runRoot,
      },
    };
  }

  async launchInstance({ task, startupTimeoutMs, startupProfile } = {}) {
    if (this.launchInFlight) {
      return this.launchInFlight;
    }

    this.launchInFlight = (async () => {
      const known = new Set((await this.beaconStore.listInternalInstances()).map((item) => item.pid));
      const launchConfig = await this.buildLaunchConfig();

      this.processController.launch(launchConfig);
      const launched = await this.beaconStore.waitForNewInstance(known, {
        timeoutMs: startupTimeoutMs ?? launchConfig.waitMs,
      });

      const fenrusLauncher = startupProfile?.fenrus_launcher;
      const sharedStartupProfile = startupProfile
        ? Object.fromEntries(
            Object.entries(startupProfile).filter(([key, value]) => key !== "fenrus_launcher" && value !== undefined),
          )
        : null;

      if (sharedStartupProfile && Object.keys(sharedStartupProfile).length > 0) {
        await this.ipcClient.sendCommand(launched, {
          cmd: "set_startup_profile",
          ...sharedStartupProfile,
        }, { requireOk: true });
      }

      await this.applyFenrusLauncher(launched, fenrusLauncher);

      if (task) {
        await this.ipcClient.sendCommand(launched, {
          cmd: "submit_initial_prompt",
          instance_id: launched.instance_id,
          prompt: task,
        }, { requireOk: true });

        // Team App can ignore very-early combo automation while the window is settling.
        // Re-apply the Fenrus selection once the task is queued so the override sticks.
        if (typeof fenrusLauncher === "string" && fenrusLauncher.length > 0) {
          await sleep(250);
          await this.applyFenrusLauncher(launched, fenrusLauncher);
        }
      }

      return launched;
    })();

    try {
      return await this.launchInFlight;
    } finally {
      this.launchInFlight = null;
    }
  }

  async closeInstance(instance) {
    const key = String(instance.pid);
    if (this.closeLocks.has(key)) {
      return this.closeLocks.get(key);
    }

    const operation = (async () => {
      let graceful = await this.processController.closeGracefully(instance.pid, 4500);
      if (!graceful) {
        graceful = false;
        await this.processController.forceKill(instance.pid, 3000);
      }

      await this.beaconStore.pruneStaleEntries();
      return {
        pid: instance.pid,
        closed: true,
        graceful,
      };
    })();

    this.closeLocks.set(key, operation);

    try {
      return await operation;
    } finally {
      this.closeLocks.delete(key);
    }
  }

  async applyFenrusLauncher(instance, fenrusLauncher) {
    if (typeof fenrusLauncher !== "string" || fenrusLauncher.length === 0) {
      return;
    }

    const fenrusComboIndex = FENRUS_COMBO_INDEX_BY_PRESET[fenrusLauncher];
    if (Number.isInteger(fenrusComboIndex)) {
      await this.ipcClient.sendCommand(instance, {
        cmd: "ui_select_combo",
        control: "fenrus_launcher",
        index: fenrusComboIndex,
      }, { requireOk: true });
      return;
    }

    await this.ipcClient.sendCommand(instance, {
      cmd: "set_startup_profile",
      fenrus_launcher: fenrusLauncher,
    }, { requireOk: true });
  }
}
