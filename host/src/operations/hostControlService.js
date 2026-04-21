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

function safeNumeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export class HostControlService {
  constructor({
    beaconStore,
    ipcClient,
    lifecycleManager,
    cliInstancesManager,
    remoteAccessState,
    quickActionsService,
    launchDedupWindowMs,
  }) {
    this.beaconStore = beaconStore;
    this.ipcClient = ipcClient;
    this.lifecycleManager = lifecycleManager;
    this.cliInstancesManager = cliInstancesManager || null;
    this.remoteAccessState = remoteAccessState;
    this.quickActionsService = quickActionsService || null;
    this.launchDedupWindowMs = launchDedupWindowMs ?? 15_000;
    this.recentLaunches = new Map();
  }

  async listInstances() {
    const [teamInstances, cliInstances] = await Promise.all([
      this.beaconStore.listInternalInstances(),
      this.listCliInstances(),
    ]);
    this.remoteAccessState?.rememberRestoreRefsFromInstances(teamInstances);
    return [
      ...teamInstances.map((entry) => this.toLanInstance(entry)),
      ...cliInstances.map((entry) => this.toLanCliInstance(entry)),
    ].sort((left, right) => (Number(right.started_at) || 0) - (Number(left.started_at) || 0));
  }

  async listRemoteInstances() {
    const [teamInstances, cliInstances] = await Promise.all([
      this.beaconStore.listInternalInstances(),
      this.listCliInstances(),
    ]);
    this.remoteAccessState?.rememberRestoreRefsFromInstances(teamInstances);
    return [
      ...teamInstances.map((entry) => this.toRemoteInstance(entry)),
      ...cliInstances.map((entry) => this.toRemoteCliInstance(entry)),
    ].sort((left, right) => (Number(right.started_at) || 0) - (Number(left.started_at) || 0));
  }

  async getInstance(instanceId) {
    if (this.isCliInstanceId(instanceId)) {
      return this.getCliInstance(instanceId);
    }
    return this.beaconStore.getInstanceById(instanceId);
  }

  async getInstanceDetail(instanceId) {
    if (this.isCliInstanceId(instanceId)) {
      return this.getCliInstanceDetail(instanceId);
    }
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

    const normalizedTitle = title?.trim() || "";

    // Reject outright when an existing running instance already has this exact
    // initial prompt — prevents accidental duplicate sessions from a double-tap,
    // retried relay request, or a second device issuing the same launch.
    // Restore flows intentionally bypass this check: restoring the same task is the point.
    if (normalizedTitle && !restoreRef && !restoreStatePath) {
      const existing = await this.beaconStore.listInternalInstances();
      const clash = existing.find((entry) => {
        const taskField =
          entry?.current_task_state?.task ??
          entry?.snapshot?.task_state?.task ??
          "";
        return typeof taskField === "string" && taskField.trim() === normalizedTitle;
      });
      if (clash) {
        const error = new Error("duplicate_initial_prompt");
        error.code = "duplicate_initial_prompt";
        error.existing_instance_id = clash.instance_id || null;
        error.existing_pid = clash.pid || null;
        throw error;
      }
    }

    const launchFingerprint = JSON.stringify({
      title: normalizedTitle,
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
    if (this.isCliInstanceId(instanceId)) {
      return this.cliInstancesManager.closeInstance(instanceId);
    }
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
    if (this.isCliInstanceId(instanceId)) {
      return this.cliInstancesManager.sendPrompt(instanceId, prompt);
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
    if (this.isCliInstanceId(instanceId)) {
      return this.cliInstancesManager.sendPrompt(instanceId, message);
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
    if (this.isCliInstanceId(instanceId)) {
      const error = new Error("not_supported");
      error.code = "not_supported";
      throw error;
    }
    const instance = await this.requireInstance(instanceId);
    return this.ipcClient.sendCommand(instance, {
      cmd: "answer_trust_prompt",
      instance_id: instance.instance_id || undefined,
      pid: instance.pid,
      approved: !!approved,
    }, { requireOk: true });
  }

  async restoreExistingInstance(instanceId, { restoreStatePath, restoreRef, remoteSafe = false }) {
    if (this.isCliInstanceId(instanceId)) {
      const error = new Error("not_supported");
      error.code = "not_supported";
      throw error;
    }
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
    if (this.isCliInstanceId(instanceId)) {
      return this.streamCliInstanceUpdates(instanceId, { cursor, onChunk, isClosed, pollIntervalMs });
    }
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
    if (this.isCliInstanceId(instanceId)) {
      return this.getCliInstance(instanceId);
    }
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

  toLanCliInstance(instance) {
    const pid = safeNumeric(instance.pid, 0);
    const startedAt = safeNumeric(instance.started_at, 0);
    return {
      id: instance.instance_id,
      instance_id: instance.instance_id,
      pid,
      hwnd: null,
      session_id: instance.instance_id,
      phase: this.cliPhase(instance),
      current_task_state: {
        phase: this.cliPhase(instance),
        task: instance.title,
        run_mode: "agent",
        launcher_preset: instance.preset,
      },
      started_at: startedAt,
      result_summary: {
        short_text: this.cliShortText(instance),
        source: "cli_output",
        truncated: !!instance.output_truncated,
      },
      status: instance.status,
      snapshot: this.cliSnapshot(instance),
      chat: this.cliChat(instance),
      summary_text: this.cliSummaryText(instance),
      terminals_by_agent: {
        erasmus: typeof instance.output === "string" ? instance.output : "",
      },
      restore_ref: null,
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

  toRemoteCliInstance(instance) {
    const pid = safeNumeric(instance.pid, 0);
    const startedAt = safeNumeric(instance.started_at, 0);
    return stripSensitivePaths({
      id: instance.instance_id,
      instance_id: instance.instance_id,
      title: instance.title,
      active: instance.status === "running" || instance.status === "closing",
      health: this.cliPhase(instance),
      phase: this.cliPhase(instance),
      pid,
      session_id: instance.instance_id,
      current_task_state: {
        phase: this.cliPhase(instance),
        task: instance.title,
        run_mode: "agent",
        launcher_preset: instance.preset,
      },
      started_at: startedAt,
      result_summary: {
        short_text: this.cliShortText(instance),
        source: "cli_output",
        truncated: !!instance.output_truncated,
      },
      restore_ref: null,
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

  isCliInstanceId(instanceId) {
    return typeof instanceId === "string" && instanceId.startsWith("cli_");
  }

  async listCliInstances() {
    if (!this.cliInstancesManager) {
      return [];
    }
    const instances = await this.cliInstancesManager.listInstances();
    return instances.filter((instance) => instance?.status === "running" || instance?.status === "closing");
  }

  getCliInstance(instanceId) {
    if (!this.cliInstancesManager) {
      const error = new Error("cli_instance_not_found");
      error.code = "cli_instance_not_found";
      throw error;
    }
    return this.cliInstancesManager.getInstance(instanceId);
  }

  async getCliInstanceDetail(instanceId) {
    const instance = this.getCliInstance(instanceId);
    return this.toLanCliInstance(instance);
  }

  async streamCliInstanceUpdates(instanceId, { cursor = 0, onChunk, isClosed = () => false, pollIntervalMs = 1000 }) {
    const sinceTs = Number.isFinite(Number(cursor)) ? Math.max(Number(cursor), 0) : 0;
    let stop = null;
    let closed = false;
    stop = this.cliInstancesManager.observeInstance(instanceId, {
      sinceTs,
      onEvent: async (event) => {
        if (closed || isClosed()) {
          return;
        }
        await onChunk(event.source || "cli", this.toRemoteEvent(event));
      },
    });
    while (!closed && !isClosed()) {
      await onChunk("heartbeat", { ts: Date.now() });
      await sleep(pollIntervalMs);
    }
    closed = true;
    try {
      stop?.();
    } catch {
      // ignore observer cleanup failures
    }
  }

  cliPhase(instance) {
    if (instance.status === "running") {
      return "running";
    }
    if (instance.status === "closing") {
      return "closing";
    }
    return "finished";
  }

  cliShortText(instance) {
    const output = typeof instance.output === "string" ? instance.output.trim() : "";
    if (output) {
      const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length > 0) {
        return lines[lines.length - 1].slice(0, 200);
      }
    }
    return instance.title || instance.preset_label || instance.instance_id;
  }

  cliSummaryText(instance) {
    return typeof instance.output === "string" ? instance.output : "";
  }

  cliChat(instance) {
    const output = typeof instance.output === "string" ? instance.output.trim() : "";
    if (!output) {
      return [];
    }
    return [
      {
        role: "assistant",
        text: output,
      },
    ];
  }

  cliSnapshot(instance) {
    return {
      phase: this.cliPhase(instance),
      task_state: {
        phase: this.cliPhase(instance),
        task: instance.title,
        run_mode: "agent",
        launcher_preset: instance.preset,
      },
      cli_instance: {
        preset: instance.preset,
        status: instance.status,
        command: instance.command,
        args: instance.args,
        exit_code: instance.exit_code,
        exit_signal: instance.exit_signal,
        event_count: instance.event_count,
        output_truncated: !!instance.output_truncated,
        total_output_chars: instance.total_output_chars,
      },
    };
  }
}
