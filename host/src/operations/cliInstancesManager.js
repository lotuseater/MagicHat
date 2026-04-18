import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pty from "node-pty";
import { readJsonFileSync, writeJsonFileSync } from "../state/jsonStateStore.js";

const MAX_OUTPUT_CHARS = 200_000;
const MAX_EVENTS_PER_INSTANCE = 2_000;
const ANSI_ESCAPE_PATTERN =
  // CSI / OSC / other common terminal control sequences.
  /\u001B(?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/gu;

// Preset → { command, defaultArgs } for "full permissions + plan mode".
// `args` is a template merged with the user's task. The task (if any) is passed as a
// final positional argument for CLIs that accept it; otherwise delivered via stdin.
export const CLI_PRESETS = Object.freeze({
  claude: {
    label: "Claude Code",
    command: "claude",
    // Skip permission prompts, start in plan mode.
    defaultArgs: ["--dangerously-skip-permissions", "--permission-mode", "plan"],
    acceptsTaskArg: true,
    requiresTty: true,
  },
  codex: {
    label: "Codex CLI",
    command: "codex",
    // Codex uses a dangerous-auto-approve flag; plan mode requested via initial prompt.
    defaultArgs: ["--dangerously-bypass-approvals-and-sandbox"],
    acceptsTaskArg: true,
    requiresTty: true,
  },
  gemini: {
    label: "Gemini CLI",
    command: "gemini",
    // Gemini CLI YOLO mode (auto-accept actions).
    defaultArgs: ["--yolo"],
    acceptsTaskArg: true,
    requiresTty: true,
  },
});

function truncate(text, max = MAX_OUTPUT_CHARS) {
  if (text.length <= max) {
    return text;
  }
  const head = text.slice(0, Math.floor(max * 0.1));
  const tail = text.slice(text.length - Math.floor(max * 0.9));
  return `${head}\n...[truncated]...\n${tail}`;
}

function sanitizeTerminalOutput(text) {
  return String(text)
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r/g, "");
}

export class CliInstancesManager {
  constructor(options = {}) {
    this.presets = options.presets || CLI_PRESETS;
    this.spawnImpl = options.spawnImpl || spawn;
    this.ptySpawnImpl =
      options.ptySpawnImpl === undefined ? pty.spawn.bind(pty) : options.ptySpawnImpl;
    this.now = options.now || (() => Date.now());
    this.idSource = options.idSource || (() => crypto.randomBytes(6).toString("hex"));
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;
    this.statePath =
      options.statePath ||
      path.join(process.cwd(), ".magichat", "cli_instances_state.json");
    this.processProbe = options.processProbe || ((pid) => this._defaultProcessProbe(pid));
    this.instances = new Map();
    this.emitter = new EventEmitter();
    // Without listeners, emit() on 'error' throws — ensure it never does.
    this.emitter.on("error", () => {});
    this._restorePersistedState();
  }

  listPresets() {
    return Object.entries(this.presets).map(([key, preset]) => ({
      preset: key,
      label: preset.label,
      command: preset.command,
      default_args: [...preset.defaultArgs],
    }));
  }

  listInstances() {
    return Array.from(this.instances.values())
      .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))
      .map((record) => this._summary(record));
  }

  getInstance(instanceId) {
    const record = this.instances.get(instanceId);
    if (!record) {
      const error = new Error("cli_instance_not_found");
      error.code = "cli_instance_not_found";
      throw error;
    }
    return this._summary(record);
  }

  launchInstance({ preset, title, initialPrompt, extraArgs } = {}) {
    const presetKey = String(preset || "").toLowerCase();
    const config = this.presets[presetKey];
    if (!config) {
      const error = new Error("unknown_cli_preset");
      error.code = "unknown_cli_preset";
      throw error;
    }
    const instanceId = `cli_${presetKey}_${this.now()}_${this.idSource()}`;
    const args = [
      ...config.defaultArgs,
      ...(Array.isArray(extraArgs) ? extraArgs.map(String) : []),
    ];
    const task = typeof initialPrompt === "string" ? initialPrompt.trim() : "";
    if (task && config.acceptsTaskArg) {
      args.push(task);
    }

    const launch = this._resolveLaunch(config.command, args, { requiresTty: config.requiresTty });
    const runtimeEnv = { ...this.env, MAGICHAT_CLI_INSTANCE_ID: instanceId };
    const child =
      launch.transport === "pty"
        ? this.ptySpawnImpl(launch.command, launch.args, {
            name: "xterm-color",
            cols: 120,
            rows: 40,
            cwd: process.cwd(),
            env: runtimeEnv,
            useConpty: this.platform === "win32",
            ...(launch.options || {}),
          })
        : this.spawnImpl(launch.command, launch.args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: runtimeEnv,
            ...(launch.options || {}),
          });

    const record = {
      instanceId,
      preset: presetKey,
      presetLabel: config.label,
      title: title?.trim() || config.label,
      command: launch.displayCommand,
      args: launch.displayArgs,
      pid: child.pid ?? null,
      startedAt: this.now(),
      endedAt: null,
      exitCode: null,
      exitSignal: null,
      status: "running",
      output: "",
      events: [],
      child,
      transport: launch.transport,
    };

    const appendChunk = (source) => (chunk) => {
      const text = sanitizeTerminalOutput(chunk.toString("utf8"));
      if (!text) {
        return;
      }
      record.output = truncate(record.output + text);
      const event = {
        ts: this.now(),
        source, // "stdout" | "stderr"
        chunk: text,
      };
      if (record.events.length >= MAX_EVENTS_PER_INSTANCE) {
        record.events.splice(0, record.events.length - MAX_EVENTS_PER_INSTANCE + 1);
      }
      record.events.push(event);
      this.emitter.emit(`instance:${instanceId}`, event);
      this._persistState();
    };

    if (launch.transport === "pty") {
      child.onData?.(appendChunk("stdout"));
    } else {
      child.stdout?.on("data", appendChunk("stdout"));
      child.stderr?.on("data", appendChunk("stderr"));
    }

    const onError = (err) => {
      record.status = "error";
      record.endedAt = this.now();
      const event = {
        ts: this.now(),
        source: "error",
        chunk: err?.message || "spawn_error",
      };
      record.events.push(event);
      this.emitter.emit(`instance:${instanceId}`, event);
      this._persistState();
    };

    if (launch.transport !== "pty") {
      child.on("error", onError);
    }

    const onExit = (code, signal) => {
      record.status = code === 0 ? "exited" : "exited_error";
      record.exitCode = code;
      record.exitSignal = signal;
      record.endedAt = this.now();
      const event = {
        ts: this.now(),
        source: "exit",
        chunk: `exit ${code ?? "?"}${signal ? ` signal=${signal}` : ""}`,
      };
      record.events.push(event);
      this.emitter.emit(`instance:${instanceId}`, event);
      this._persistState();
    };

    if (launch.transport === "pty") {
      child.onExit?.(({ exitCode, signal }) => onExit(exitCode, signal ?? null));
    } else {
      child.on("exit", onExit);
    }

    if (task && !config.acceptsTaskArg && launch.transport === "pty") {
      try {
        child.write(`${task}\r`);
      } catch {
        // PTY may not be writable yet; follow-up prompt can retry.
      }
    } else if (task && !config.acceptsTaskArg && child.stdin) {
      try {
        child.stdin.write(task);
        child.stdin.write("\n");
      } catch {
        // stdin may not be writable yet; ignore — prompt endpoint can retry.
      }
    }

    this.instances.set(instanceId, record);
    this._persistState();
    return this._summary(record);
  }

  sendPrompt(instanceId, prompt) {
    const record = this._require(instanceId);
    if (record.status !== "running") {
      const error = new Error("cli_instance_not_running");
      error.code = "cli_instance_not_running";
      throw error;
    }
    const text = typeof prompt === "string" ? prompt : "";
    if (!text) {
      const error = new Error("empty_prompt");
      error.code = "empty_prompt";
      throw error;
    }
    if (record.transport === "pty") {
      const writer = record.child?.write;
      if (typeof writer !== "function") {
        const error = new Error("stdin_unavailable");
        error.code = "stdin_unavailable";
        throw error;
      }
      writer.call(record.child, `${text}\r`);
      this._persistState();
      return { status: "sent" };
    }
    const stdin = record.child?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      const error = new Error("stdin_unavailable");
      error.code = "stdin_unavailable";
      throw error;
    }
    stdin.write(text.endsWith("\n") ? text : `${text}\n`);
    this._persistState();
    return { status: "sent" };
  }

  closeInstance(instanceId, { force = false } = {}) {
    const record = this._require(instanceId);
    if (record.status !== "running") {
      this.instances.delete(instanceId);
      this._persistState();
      return { status: "already_closed" };
    }
    const signal = force ? "SIGKILL" : "SIGTERM";
    if (!record.child && record.pid) {
      try {
        process.kill(record.pid, signal);
        record.status = "closing";
        this._persistState();
        return { status: "closing", signal };
      } catch {
        record.status = "exited_error";
        record.endedAt = this.now();
        this._persistState();
        this.instances.delete(instanceId);
        this._persistState();
        return { status: "already_closed" };
      }
    }
    try {
      record.child.kill(signal);
    } catch (err) {
      // Process may already be gone.
    }
    this._persistState();
    return { status: "closing", signal };
  }

  observeInstance(instanceId, { onEvent, onClose, sinceTs = 0 } = {}) {
    const record = this._require(instanceId);
    for (const event of record.events) {
      if (event.ts > sinceTs) {
        onEvent?.(event);
      }
    }
    const handler = (event) => onEvent?.(event);
    this.emitter.on(`instance:${instanceId}`, handler);
    const stop = () => {
      this.emitter.off(`instance:${instanceId}`, handler);
      onClose?.();
    };
    return stop;
  }

  _require(instanceId) {
    const record = this.instances.get(instanceId);
    if (!record) {
      const error = new Error("cli_instance_not_found");
      error.code = "cli_instance_not_found";
      throw error;
    }
    return record;
  }

  _summary(record) {
    return {
      instance_id: record.instanceId,
      preset: record.preset,
      preset_label: record.presetLabel,
      title: record.title,
      command: record.command,
      args: [...record.args],
      pid: record.pid,
      started_at: record.startedAt,
      ended_at: record.endedAt,
      exit_code: record.exitCode,
      exit_signal: record.exitSignal,
      status: record.status,
      output: record.output,
      event_count: record.events.length,
    };
  }

  _restorePersistedState() {
    const state = readJsonFileSync(this.statePath, { instances: [] });
    const saved = Array.isArray(state?.instances) ? state.instances : [];
    for (const raw of saved) {
      if (!raw?.instance_id) {
        continue;
      }
      const wasRunning = raw.status === "running" || raw.status === "closing";
      const stillRunning = wasRunning && raw.pid ? this.processProbe(raw.pid) : false;
      const record = {
        instanceId: raw.instance_id,
        preset: raw.preset,
        presetLabel: raw.preset_label,
        title: raw.title,
        command: raw.command,
        args: Array.isArray(raw.args) ? raw.args.map(String) : [],
        pid: raw.pid ?? null,
        startedAt: raw.started_at ?? null,
        endedAt: stillRunning ? null : (raw.ended_at ?? (wasRunning ? this.now() : null)),
        exitCode: raw.exit_code ?? null,
        exitSignal: raw.exit_signal ?? null,
        status: stillRunning ? "running" : (raw.status || "exited"),
        output: typeof raw.output === "string" ? raw.output : "",
        events: Array.isArray(raw.events) ? raw.events : [],
        child: null,
      };
      if (wasRunning && !stillRunning) {
        record.status = "exited";
        record.events.push({
          ts: this.now(),
          source: "restore",
          chunk: "process no longer running after host restart",
        });
      }
      this.instances.set(record.instanceId, record);
    }
    this._persistState();
  }

  _persistState() {
    writeJsonFileSync(this.statePath, {
      instances: Array.from(this.instances.values()).map((record) => ({
        ...this._summary(record),
        events: record.events,
      })),
    });
  }

  _defaultProcessProbe(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  _resolveLaunch(command, args, options = {}) {
    if (this.platform !== "win32") {
      return {
        transport: options.requiresTty && this.ptySpawnImpl ? "pty" : "spawn",
        command,
        args,
        displayCommand: command,
        displayArgs: args,
      };
    }

    const resolvedCommand = this._resolveWindowsCommand(command);
    if (options.requiresTty && this.ptySpawnImpl) {
      return {
        transport: "pty",
        command: resolvedCommand,
        args,
        displayCommand: resolvedCommand,
        displayArgs: args,
      };
    }

    const ext = path.extname(resolvedCommand).toLowerCase();
    if (ext === ".ps1") {
      const powershell =
        this._firstExistingPath([
          path.join(this.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          "powershell.exe",
        ]) || "powershell.exe";
      return {
        transport: "spawn",
        command: powershell,
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolvedCommand, ...args],
        displayCommand: resolvedCommand,
        displayArgs: args,
      };
    }

    if (ext === ".cmd" || ext === ".bat") {
      const cmdExe =
        this._firstExistingPath([
          path.join(this.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
          "cmd.exe",
        ]) || "cmd.exe";
      const commandLine = [resolvedCommand, ...args]
        .map((value) => this._quoteForWindowsCmd(value))
        .join(" ");
      return {
        transport: "spawn",
        command: commandLine,
        args: [],
        options: { shell: cmdExe },
        displayCommand: resolvedCommand,
        displayArgs: args,
      };
    }

    return {
      transport: "spawn",
      command: resolvedCommand,
      args,
      displayCommand: resolvedCommand,
      displayArgs: args,
    };
  }

  _resolveWindowsCommand(command) {
    const candidates = [];
    const seen = new Set();
    const addCandidate = (value) => {
      if (!value) return;
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(value);
    };

    addCandidate(command);
    const exts = ["", ".exe", ".cmd", ".bat", ".ps1"];
    const pathEntries = String(this.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean);
    const home = this.env.USERPROFILE || os.homedir();
    const appData = this.env.APPDATA || (home ? path.join(home, "AppData", "Roaming") : "");
    const commonDirs = [
      ...pathEntries,
      home ? path.join(home, ".dotnet", "tools") : "",
      home ? path.join(home, ".local", "bin") : "",
      appData ? path.join(appData, "npm") : "",
    ].filter(Boolean);

    for (const dir of commonDirs) {
      for (const ext of exts) {
        addCandidate(path.join(dir, `${command}${ext}`));
      }
    }

    return this._firstExistingPath(candidates) || command;
  }

  _firstExistingPath(candidates) {
    for (const candidate of candidates) {
      try {
        if (!candidate.includes(path.sep) && !candidate.includes("/")) {
          continue;
        }
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // Ignore malformed candidates and keep searching.
      }
    }
    return null;
  }

  _quoteForWindowsCmd(value) {
    if (value === "") {
      return '""';
    }
    const escaped = String(value).replace(/"/g, '""');
    return /[\s"]/u.test(escaped) ? `"${escaped}"` : escaped;
  }
}
