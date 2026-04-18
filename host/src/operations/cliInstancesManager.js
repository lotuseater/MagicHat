import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const MAX_OUTPUT_CHARS = 200_000;
const MAX_EVENTS_PER_INSTANCE = 2_000;

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
  },
  codex: {
    label: "Codex CLI",
    command: "codex",
    // Codex uses a dangerous-auto-approve flag; plan mode requested via initial prompt.
    defaultArgs: ["--dangerously-bypass-approvals-and-sandbox"],
    acceptsTaskArg: true,
  },
  gemini: {
    label: "Gemini CLI",
    command: "gemini",
    // Gemini CLI YOLO mode (auto-accept actions).
    defaultArgs: ["--yolo"],
    acceptsTaskArg: true,
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

export class CliInstancesManager {
  constructor(options = {}) {
    this.presets = options.presets || CLI_PRESETS;
    this.spawnImpl = options.spawnImpl || spawn;
    this.now = options.now || (() => Date.now());
    this.idSource = options.idSource || (() => crypto.randomBytes(6).toString("hex"));
    this.instances = new Map();
    this.emitter = new EventEmitter();
    // Without listeners, emit() on 'error' throws — ensure it never does.
    this.emitter.on("error", () => {});
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
    return Array.from(this.instances.values()).map((record) => this._summary(record));
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

    const child = this.spawnImpl(config.command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MAGICHAT_CLI_INSTANCE_ID: instanceId },
    });

    const record = {
      instanceId,
      preset: presetKey,
      presetLabel: config.label,
      title: title?.trim() || config.label,
      command: config.command,
      args,
      pid: child.pid ?? null,
      startedAt: this.now(),
      endedAt: null,
      exitCode: null,
      exitSignal: null,
      status: "running",
      output: "",
      events: [],
      child,
    };

    const appendChunk = (source) => (chunk) => {
      const text = chunk.toString("utf8");
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
    };

    child.stdout?.on("data", appendChunk("stdout"));
    child.stderr?.on("data", appendChunk("stderr"));

    child.on("error", (err) => {
      record.status = "error";
      record.endedAt = this.now();
      const event = {
        ts: this.now(),
        source: "error",
        chunk: err?.message || "spawn_error",
      };
      record.events.push(event);
      this.emitter.emit(`instance:${instanceId}`, event);
    });

    child.on("exit", (code, signal) => {
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
    });

    if (task && !config.acceptsTaskArg && child.stdin) {
      try {
        child.stdin.write(task);
        child.stdin.write("\n");
      } catch {
        // stdin may not be writable yet; ignore — prompt endpoint can retry.
      }
    }

    this.instances.set(instanceId, record);
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
    const stdin = record.child?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      const error = new Error("stdin_unavailable");
      error.code = "stdin_unavailable";
      throw error;
    }
    stdin.write(text.endsWith("\n") ? text : `${text}\n`);
    return { status: "sent" };
  }

  closeInstance(instanceId, { force = false } = {}) {
    const record = this._require(instanceId);
    if (record.status !== "running") {
      this.instances.delete(instanceId);
      return { status: "already_closed" };
    }
    const signal = force ? "SIGKILL" : "SIGTERM";
    try {
      record.child.kill(signal);
    } catch (err) {
      // Process may already be gone.
    }
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
}
