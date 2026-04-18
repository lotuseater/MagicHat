function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripSensitivePaths(value) {
  if (Array.isArray(value)) {
    return value.map(stripSensitivePaths);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const hiddenKeys = new Set([
    "cmd_path",
    "resp_path",
    "events_path",
    "run_log_path",
    "artifact_dir",
    "run_artifact_dir",
    "restore_state_path",
  ]);

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (hiddenKeys.has(key)) {
      continue;
    }
    result[key] = stripSensitivePaths(child);
  }
  return result;
}

function preferredTitle(instance) {
  return (
    instance.current_task_state?.task ||
    instance.result_summary?.short_text ||
    instance.session_id ||
    instance.instance_id ||
    String(instance.pid)
  );
}

function summarizeHealth(instance) {
  return instance.phase || instance.current_task_state?.phase || "unknown";
}

export class HostControlService {
  constructor({
    beaconStore,
    ipcClient,
    lifecycleManager,
    remoteAccessState,
    quickActionsService,
    launchDedupWindowMs,
  }) {
    this.beaconStore = beaconStore;
    this.ipcClient = ipcClient;
    this.lifecycleManager = lifecycleManager;
    this.remoteAccessState = remoteAccessState;
    this.quickActionsService = quickActionsService || null;
    this.launchDedupWindowMs = launchDedupWindowMs ?? 15_000;
    this.recentLaunches = new Map();
  }

  async listInstances() {
    const instances = await this.beaconStore.listInternalInstances();
    this.remoteAccessState?.rememberRestoreRefsFromInstances(instances);
    return instances.map((entry) => this.toLanInstance(entry));
  }

  async listRemoteInstances() {
    const instances = await this.beaconStore.listInternalInstances();
    this.remoteAccessState?.rememberRestoreRefsFromInstances(instances);
    return instances.map((entry) => this.toRemoteInstance(entry));
  }

  async getInstance(instanceId) {
    return this.beaconStore.getInstanceById(instanceId);
  }

  async getInstanceDetail(instanceId) {
    const instance = await this.requireInstance(instanceId);
    this.remoteAccessState?.rememberRestoreRefsFromInstances([instance]);
    const inspect = await this.ipcClient.inspect(instance, {
      include_chat: true,
      include_summary: true,
      include_terminals: true,
    });
    return {
      ...this.toLanInstance(instance),
      status: inspect?.status || "error",
      snapshot: inspect?.snapshot || {},
      chat: Array.isArray(inspect?.chat) ? inspect.chat : [],
      summary_text: typeof inspect?.summary_text === "string" ? inspect.summary_text : "",
      terminals_by_agent:
        inspect?.terminals_by_agent && typeof inspect?.terminals_by_agent === "object"
          ? inspect.terminals_by_agent
          : {},
      run_log_path: inspect?.run_log_path || "",
    };
  }

  async getRemoteInstanceDetail(instanceId) {
    const detail = await this.getInstanceDetail(instanceId);
    return this.toRemoteDetail(detail);
  }

  startupProfileFromRequest({ teamMode, launcherPreset, fenrusLauncher } = {}) {
    return Object.fromEntries(
      Object.entries({
        team_mode: teamMode?.trim() || undefined,
        launcher_preset: launcherPreset?.trim() || undefined,
        fenrus_launcher: fenrusLauncher?.trim() || undefined,
      }).filter(([, value]) => typeof value === "string" && value.length > 0),
    );
  }

  async launchInstance({
    title,
    restoreStatePath,
    restoreRef,
    startupTimeoutMs,
    teamMode,
    launcherPreset,
    fenrusLauncher,
    remoteSafe = false,
  } = {}) {
    let resolvedRestorePath = restoreStatePath || null;
    if (restoreRef) {
      resolvedRestorePath = this.remoteAccessState?.resolveRestoreRef(restoreRef) || null;
      if (!resolvedRestorePath) {
        const error = new Error("restore_ref_not_allowed");
        error.code = "restore_ref_not_allowed";
        throw error;
      }
    }
    if (remoteSafe && restoreStatePath) {
      const error = new Error("restore_ref_not_allowed");
      error.code = "restore_ref_not_allowed";
      throw error;
    }
    if (restoreStatePath && restoreRef) {
      const error = new Error("restore_ref_not_allowed");
      error.code = "restore_ref_not_allowed";
      throw error;
    }

    const launchFingerprint = JSON.stringify({
      title: title?.trim() || "",
      restore_state_path: resolvedRestorePath || "",
      restore_ref: restoreRef?.trim() || "",
      team_mode: teamMode?.trim() || "",
      launcher_preset: launcherPreset?.trim() || "",
      fenrus_launcher: fenrusLauncher?.trim() || "",
    });

    const cached = this.recentLaunches.get(launchFingerprint);
    if (cached?.promise) {
      const launched = await cached.promise;
      return remoteSafe ? this.toRemoteInstance(launched) : this.toLanInstance(launched);
    }
    if (cached?.completedAt && Date.now() - cached.completedAt <= this.launchDedupWindowMs) {
      const existing =
        (cached.instanceId && (await this.beaconStore.getInstanceById(cached.instanceId))) ||
        cached.instance ||
        null;
      if (existing) {
        return remoteSafe ? this.toRemoteInstance(existing) : this.toLanInstance(existing);
      }
      this.recentLaunches.delete(launchFingerprint);
    }

    const startupProfile = this.startupProfileFromRequest({
      teamMode,
      launcherPreset,
      fenrusLauncher,
    });
    const operation = (async () => {
      const launched = await this.lifecycleManager.launchInstance({
        task: title?.trim() || undefined,
        startupTimeoutMs,
        startupProfile,
      });

      if (resolvedRestorePath) {
        await this.ipcClient.sendCommand(launched, {
          cmd: "restore_session",
          path: resolvedRestorePath,
        }, { requireOk: true });
      }

      return launched;
    })();

    this.recentLaunches.set(launchFingerprint, { promise: operation });

    try {
      const launched = await operation;
      this.recentLaunches.set(launchFingerprint, {
        completedAt: Date.now(),
        instanceId: launched.instance_id || String(launched.pid),
        instance: launched,
      });
      return remoteSafe ? this.toRemoteInstance(launched) : this.toLanInstance(launched);
    } catch (error) {
      const current = this.recentLaunches.get(launchFingerprint);
      if (current?.promise === operation) {
        this.recentLaunches.delete(launchFingerprint);
      }
      throw error;
    }
  }

  async closeInstance(instanceId) {
    const instance = await this.requireInstance(instanceId);
    await this.ipcClient.sendCommand(instance, {
      cmd: "close_instance",
      instance_id: instance.instance_id || undefined,
      pid: instance.pid,
    }, { requireOk: true });
    return this.lifecycleManager.closeInstance(instance);
  }

  async sendPrompt(instanceId, prompt) {
    const quickAction = await this.quickActionsService?.executeHookText(prompt);
    if (quickAction) {
      return quickAction;
    }
    const instance = await this.requireInstance(instanceId);
    return this.ipcClient.sendCommand(instance, {
      cmd: "submit_initial_prompt",
      instance_id: instance.instance_id || undefined,
      pid: instance.pid,
      prompt,
    }, { requireOk: true });
  }

  async sendFollowUp(instanceId, message) {
    const quickAction = await this.quickActionsService?.executeHookText(message);
    if (quickAction) {
      return quickAction;
    }
    const instance = await this.requireInstance(instanceId);
    return this.ipcClient.sendCommand(instance, {
      cmd: "submit_follow_up",
      instance_id: instance.instance_id || undefined,
      pid: instance.pid,
      prompt: message,
    }, { requireOk: true });
  }

  async answerTrustPrompt(instanceId, approved) {
    const instance = await this.requireInstance(instanceId);
    return this.ipcClient.sendCommand(instance, {
      cmd: "answer_trust_prompt",
      instance_id: instance.instance_id || undefined,
      pid: instance.pid,
      approved: !!approved,
    }, { requireOk: true });
  }

  async restoreExistingInstance(instanceId, { restoreStatePath, restoreRef, remoteSafe = false }) {
    const instance = await this.requireInstance(instanceId);
    let resolvedRestorePath = restoreStatePath || null;
    if (remoteSafe) {
      resolvedRestorePath = restoreRef ? this.remoteAccessState?.resolveRestoreRef(restoreRef) : null;
      if (!resolvedRestorePath) {
        const error = new Error("restore_ref_not_allowed");
        error.code = "restore_ref_not_allowed";
        throw error;
      }
    }
    await this.ipcClient.sendCommand(instance, {
      cmd: "restore_session",
      path: resolvedRestorePath,
    }, { requireOk: true });
    return { status: "queued" };
  }

  async listKnownRestoreRefs() {
    const instances = await this.beaconStore.listInternalInstances();
    this.remoteAccessState?.rememberRestoreRefsFromInstances(instances);
    return this.remoteAccessState?.listKnownRestoreRefs() || [];
  }

  async streamInstanceUpdates(instanceId, { cursor = 0, onChunk, isClosed = () => false, pollIntervalMs = 1000 }) {
    let rollingCursor = Number.isFinite(Number(cursor)) ? Math.max(Number(cursor), 0) : 0;

    while (!isClosed()) {
      const current = await this.beaconStore.getInstanceById(instanceId);
      if (!current) {
        await onChunk("instance_missing", { instance_id: instanceId });
        break;
      }

      const update = await this.ipcClient.tailEvents(current, rollingCursor);
      if (update.events.length > 0) {
        for (const event of update.events) {
          await onChunk(update.source, this.toRemoteEvent(event));
        }
      } else {
        await onChunk("heartbeat", { ts: Date.now() });
      }
      rollingCursor = update.next_cursor;
      await sleep(pollIntervalMs);
    }
  }

  async requireInstance(instanceId) {
    const instance = await this.beaconStore.getInstanceById(instanceId);
    if (!instance) {
      const error = new Error("instance_not_found");
      error.code = "instance_not_found";
      throw error;
    }
    return instance;
  }

  toLanInstance(instance) {
    const restoreRef = instance.restore_state_path
      ? this.remoteAccessState?.rememberRestorePath(instance.restore_state_path, {
          session_id: instance.session_id,
          title: preferredTitle(instance),
        })
      : null;

    return {
      ...this.beaconStore.toPublicInstance(instance),
      restore_ref: restoreRef || null,
    };
  }

  toRemoteInstance(instance) {
    const restoreRef = this.remoteAccessState?.rememberRestorePath(instance.restore_state_path, {
      session_id: instance.session_id,
      title: preferredTitle(instance),
    });

    return stripSensitivePaths({
      id: instance.instance_id || String(instance.pid),
      instance_id: instance.instance_id || String(instance.pid),
      title: preferredTitle(instance),
      active: summarizeHealth(instance).toLowerCase() !== "finished",
      health: summarizeHealth(instance),
      phase: instance.phase,
      pid: instance.pid,
      session_id: instance.session_id,
      current_task_state: instance.current_task_state,
      started_at: instance.started_at,
      result_summary: instance.result_summary,
      restore_ref: restoreRef || null,
    });
  }

  toRemoteDetail(detail) {
    const restoreRef = detail.restore_state_path
      ? this.remoteAccessState?.rememberRestorePath(detail.restore_state_path, {
          session_id: detail.session_id,
          title: preferredTitle(detail),
        })
      : null;

    return stripSensitivePaths({
      ...this.toRemoteInstance(detail),
      status: detail.status,
      snapshot: stripSensitivePaths(detail.snapshot || {}),
      chat: stripSensitivePaths(detail.chat || []),
      summary_text: detail.summary_text || "",
      terminals_by_agent: stripSensitivePaths(detail.terminals_by_agent || {}),
      restore_ref: restoreRef || null,
    });
  }

  toRemoteEvent(event) {
    return stripSensitivePaths(event);
  }
}
