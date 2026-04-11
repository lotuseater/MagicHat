export class LifecycleManager {
  constructor({ beaconStore, ipcClient, processController, launchConfig }) {
    this.beaconStore = beaconStore;
    this.ipcClient = ipcClient;
    this.processController = processController;
    this.launchConfig = launchConfig;

    this.launchInFlight = null;
    this.closeLocks = new Map();
  }

  async launchInstance({ task, startupTimeoutMs } = {}) {
    if (this.launchInFlight) {
      return this.launchInFlight;
    }

    this.launchInFlight = (async () => {
      const known = new Set((await this.beaconStore.listInternalInstances()).map((item) => item.pid));

      this.processController.launch(this.launchConfig);
      const launched = await this.beaconStore.waitForNewInstance(known, {
        timeoutMs: startupTimeoutMs ?? this.launchConfig.waitMs,
      });

      if (task) {
        await this.ipcClient.sendCommand(launched, {
          cmd: "submit_initial_prompt",
          instance_id: launched.instance_id,
          prompt: task,
        });
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
}
