import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInstancesManager, CLI_PRESETS } from "../../host/src/operations/cliInstancesManager.js";

function fakeChild() {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdinWrites = [];
  const stdin = {
    destroyed: false,
    writableEnded: false,
    write: vi.fn((chunk) => {
      stdinWrites.push(chunk);
      return true;
    }),
  };
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.stdin = stdin;
  emitter.pid = 4242;
  emitter.kill = vi.fn((signal) => {
    emitter.emit("exit", signal === "SIGKILL" ? 137 : 0, signal);
  });
  emitter._stdinWrites = stdinWrites;
  return emitter;
}

describe("CliInstancesManager", () => {
  let manager;
  let spawnImpl;
  let child;
  let stateRoot;
  let statePath;

  beforeEach(async () => {
    child = fakeChild();
    spawnImpl = vi.fn(() => child);
    stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-cli-manager-"));
    statePath = path.join(stateRoot, "cli_instances.json");
    manager = new CliInstancesManager({ spawnImpl, ptySpawnImpl: null, now: () => 1_000, statePath });
  });

  afterEach(async () => {
    if (stateRoot) {
      await fs.rm(stateRoot, { recursive: true, force: true });
      stateRoot = null;
      statePath = null;
    }
  });

  it("exposes the built-in presets", () => {
    const presets = manager.listPresets().map((p) => p.preset).sort();
    expect(presets).toEqual(["claude", "codex", "gemini"]);
    const claude = manager.listPresets().find((p) => p.preset === "claude");
    expect(claude.default_args).toContain("--dangerously-skip-permissions");
    expect(claude.default_args).toContain("plan");
  });

  it("launches with preset default args and records the instance", () => {
    const summary = manager.launchInstance({ preset: "claude", title: "explore repo" });
    const [command, resolvedArgs, options] = spawnImpl.mock.calls[0];
    expect(command.toLowerCase()).toContain("claude");
    expect(resolvedArgs).toEqual(
      expect.arrayContaining(["--dangerously-skip-permissions", "--permission-mode", "plan"]),
    );
    expect(options).toEqual(expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }));
    expect(summary.preset).toBe("claude");
    expect(summary.status).toBe("running");
    expect(summary.title).toBe("explore repo");
    expect(manager.listInstances()).toHaveLength(1);
  });

  it("passes the initial prompt as a trailing argument when preset accepts it", () => {
    manager.launchInstance({ preset: "gemini", initialPrompt: "refactor auth" });
    const args = spawnImpl.mock.calls[0][1];
    expect(args[args.length - 1]).toBe("refactor auth");
    expect(args).toContain("--yolo");
  });

  it("rejects unknown presets with a typed error code", () => {
    expect(() => manager.launchInstance({ preset: "bogus" })).toThrowError(
      expect.objectContaining({ code: "unknown_cli_preset" }),
    );
  });

  it("buffers stdout and stderr into the output field and events", () => {
    const summary = manager.launchInstance({ preset: "claude" });
    child.stdout.emit("data", Buffer.from("hello "));
    child.stderr.emit("data", Buffer.from("warn\n"));
    const detail = manager.getInstance(summary.instance_id);
    expect(detail.output).toBe("hello warn\n");
    expect(detail.event_count).toBe(2);
  });

  it("strips ANSI terminal sequences from buffered output", () => {
    const summary = manager.launchInstance({ preset: "claude" });
    child.stdout.emit("data", Buffer.from("\u001b[2J\u001b[Hhello\r\n"));
    const detail = manager.getInstance(summary.instance_id);
    expect(detail.output).toBe("hello\n");
    expect(detail.event_count).toBe(1);
  });

  it("streams events via observeInstance, replaying history newer than sinceTs", () => {
    const summary = manager.launchInstance({ preset: "claude" });
    child.stdout.emit("data", Buffer.from("first"));
    const received = [];
    const stop = manager.observeInstance(summary.instance_id, {
      onEvent: (event) => received.push(event),
      sinceTs: 0,
    });
    child.stdout.emit("data", Buffer.from("second"));
    stop();
    child.stdout.emit("data", Buffer.from("third"));
    expect(received.map((e) => e.chunk)).toEqual(["first", "second"]);
  });

  it("sends follow-up prompts via stdin with a trailing newline", () => {
    const summary = manager.launchInstance({ preset: "codex" });
    manager.sendPrompt(summary.instance_id, "next step");
    expect(child.stdin.write).toHaveBeenLastCalledWith("next step\n");
  });

  it("rejects prompts when stdin is gone", () => {
    const summary = manager.launchInstance({ preset: "codex" });
    child.stdin.destroyed = true;
    expect(() => manager.sendPrompt(summary.instance_id, "ping")).toThrowError(
      expect.objectContaining({ code: "stdin_unavailable" }),
    );
  });

  it("marks the instance as exited when the child exits", () => {
    const summary = manager.launchInstance({ preset: "claude" });
    child.emit("exit", 0, null);
    const detail = manager.getInstance(summary.instance_id);
    expect(detail.status).toBe("exited");
    expect(detail.exit_code).toBe(0);
  });

  it("closes a running instance via SIGTERM by default", () => {
    const summary = manager.launchInstance({ preset: "claude" });
    const result = manager.closeInstance(summary.instance_id);
    expect(result.status).toBe("closing");
    expect(result.signal).toBe("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("force-closes with SIGKILL when requested", () => {
    const summary = manager.launchInstance({ preset: "claude" });
    manager.closeInstance(summary.instance_id, { force: true });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("keeps the preset table stable", () => {
    // Guard against accidental removal / rename — this shape is part of the wire contract.
    expect(Object.keys(CLI_PRESETS).sort()).toEqual(["claude", "codex", "gemini"]);
  });

  it("reports output_truncated + total_output_chars so the UI can label a lossy buffer", () => {
    const summary = manager.launchInstance({ preset: "claude" });
    const fatChunk = "a".repeat(250_000);
    child.stdout.emit("data", Buffer.from(fatChunk));
    const detail = manager.getInstance(summary.instance_id);
    expect(detail.output_truncated).toBe(true);
    expect(detail.total_output_chars).toBeGreaterThanOrEqual(250_000);
    expect(detail.output).toContain("[truncated]");
  });

  it("leaves small outputs untouched and does not flag them as truncated", () => {
    const summary = manager.launchInstance({ preset: "codex" });
    child.stdout.emit("data", Buffer.from("hello"));
    const detail = manager.getInstance(summary.instance_id);
    expect(detail.output_truncated).toBe(false);
    expect(detail.total_output_chars).toBe(5);
  });

  it("rejects too many extra_args to prevent argv-flooding DoS", () => {
    const tooMany = Array.from({ length: 100 }, (_, i) => `--flag-${i}`);
    expect(() => manager.launchInstance({ preset: "claude", extraArgs: tooMany })).toThrowError(
      expect.objectContaining({ code: "too_many_extra_args" }),
    );
  });

  it("rejects oversized single extra_arg", () => {
    const huge = "x".repeat(3000);
    expect(() => manager.launchInstance({ preset: "claude", extraArgs: [huge] })).toThrowError(
      expect.objectContaining({ code: "extra_arg_too_long" }),
    );
  });

  it("surfaces stdin write failures as typed errors, not silent drops", () => {
    const summary = manager.launchInstance({ preset: "codex" });
    child.stdin.write = vi.fn(() => {
      throw new Error("EPIPE");
    });
    expect(() => manager.sendPrompt(summary.instance_id, "hello")).toThrowError(
      expect.objectContaining({ code: "stdin_write_failed" }),
    );
  });

  it("blocks a second CLI launch with the same preset + initial prompt", () => {
    manager.launchInstance({ preset: "claude", initialPrompt: "explore repo" });
    expect(() => manager.launchInstance({ preset: "claude", initialPrompt: "explore repo" })).toThrowError(
      expect.objectContaining({ code: "duplicate_initial_prompt" }),
    );
    // Different prompt is fine; different preset is fine.
    expect(() => manager.launchInstance({ preset: "claude", initialPrompt: "something else" }))
      .not.toThrow();
    expect(() => manager.launchInstance({ preset: "codex", initialPrompt: "explore repo" }))
      .not.toThrow();
  });

  it("allows relaunching once the first CLI has exited", () => {
    // Replace the default (shared-child) spawnImpl with one that mints a fresh
    // child each time, so exiting the first doesn't also exit the second.
    const children = [];
    manager = new CliInstancesManager({
      spawnImpl: vi.fn(() => {
        const next = fakeChild();
        children.push(next);
        return next;
      }),
      ptySpawnImpl: null,
      now: () => 1_000,
      statePath,
    });
    const summary = manager.launchInstance({ preset: "claude", initialPrompt: "explore repo" });
    expect(() => manager.launchInstance({ preset: "claude", initialPrompt: "explore repo" })).toThrowError(
      expect.objectContaining({ code: "duplicate_initial_prompt" }),
    );
    // Simulate only the first process exiting.
    children[0].emit("exit", 0, null);
    const relaunched = manager.launchInstance({ preset: "claude", initialPrompt: "explore repo" });
    expect(relaunched.instance_id).not.toBe(summary.instance_id);
    expect(relaunched.status).toBe("running");
  });

  it("restores persisted instances across manager restart", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-cli-manager-"));
    const restoreStatePath = path.join(tempRoot, "cli_instances.json");
    const firstChild = fakeChild();
    const firstManager = new CliInstancesManager({
      spawnImpl: vi.fn(() => firstChild),
      ptySpawnImpl: null,
      now: () => 1_000,
      statePath: restoreStatePath,
    });

    const launched = firstManager.launchInstance({ preset: "claude", title: "persist me" });
    firstChild.stdout.emit("data", Buffer.from("hello"));

    const restored = new CliInstancesManager({
      spawnImpl: vi.fn(),
      ptySpawnImpl: null,
      now: () => 2_000,
      statePath: restoreStatePath,
      processProbe: vi.fn((pid) => pid === 4242),
    });

    const instances = restored.listInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0].instance_id).toBe(launched.instance_id);
    expect(instances[0].title).toBe("persist me");
    expect(instances[0].output).toContain("hello");

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("can stop a restored running instance by pid", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-cli-manager-"));
    const restoreStatePath = path.join(tempRoot, "cli_instances.json");
    const child = fakeChild();
    const manager = new CliInstancesManager({
      spawnImpl: vi.fn(() => child),
      ptySpawnImpl: null,
      now: () => 1_000,
      statePath: restoreStatePath,
    });
    const launched = manager.launchInstance({ preset: "gemini" });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const restored = new CliInstancesManager({
      spawnImpl: vi.fn(),
      ptySpawnImpl: null,
      now: () => 2_000,
      statePath: restoreStatePath,
      processProbe: vi.fn(() => true),
    });

    const result = restored.closeInstance(launched.instance_id);
    expect(result.status).toBe("closing");
    expect(killSpy).toHaveBeenCalledWith(4242, "SIGTERM");

    killSpy.mockRestore();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("resolves codex from common Windows tool paths", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-cli-manager-"));
    const winHome = path.join(tempRoot, "home");
    const codexDir = path.join(winHome, ".dotnet", "tools");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "codex.cmd"), "@echo off\r\n", "utf8");
    const winManager = new CliInstancesManager({
      spawnImpl,
      ptySpawnImpl: null,
      now: () => 1_000,
      statePath: path.join(tempRoot, "cli_instances.json"),
      platform: "win32",
      env: {
        PATH: "C:\\Windows\\System32",
        USERPROFILE: winHome,
        APPDATA: path.join(winHome, "AppData", "Roaming"),
        SystemRoot: "C:\\Windows",
      },
    });

    winManager.launchInstance({ preset: "codex" });

    const [command, args, options] = spawnImpl.mock.calls[0];
    expect(command).toContain(path.join(codexDir, "codex.cmd"));
    expect(command).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).toEqual([]);
    expect(options).toEqual(expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }));
    expect(options.shell).toBe("C:\\Windows\\System32\\cmd.exe");

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("resolves gemini from roaming npm on Windows", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-cli-manager-"));
    const winHome = path.join(tempRoot, "home");
    const npmDir = path.join(winHome, "AppData", "Roaming", "npm");
    await fs.mkdir(npmDir, { recursive: true });
    await fs.writeFile(path.join(npmDir, "gemini.cmd"), "@echo off\r\n", "utf8");
    const winManager = new CliInstancesManager({
      spawnImpl,
      ptySpawnImpl: null,
      now: () => 1_000,
      statePath: path.join(tempRoot, "cli_instances.json"),
      platform: "win32",
      env: {
        PATH: "C:\\Windows\\System32",
        USERPROFILE: winHome,
        APPDATA: path.join(winHome, "AppData", "Roaming"),
        SystemRoot: "C:\\Windows",
      },
    });

    winManager.launchInstance({ preset: "gemini" });

    const [command, args, options] = spawnImpl.mock.calls[0];
    expect(command).toContain(path.join(npmDir, "gemini.cmd"));
    expect(command).toContain("--yolo");
    expect(args).toEqual([]);
    expect(options).toEqual(expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }));
    expect(options.shell).toBe("C:\\Windows\\System32\\cmd.exe");

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("opens a visible mirror window for Windows PTY launches", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-cli-manager-"));
    const statePath = path.join(tempRoot, "cli_instances.json");
    const ptyChild = {
      pid: 5151,
      write: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    };
    const ptySpawnImpl = vi.fn(() => ptyChild);
    const mirrorChild = { unref: vi.fn() };
    const mirrorSpawnImpl = vi.fn(() => mirrorChild);
    const manager = new CliInstancesManager({
      spawnImpl: vi.fn(),
      mirrorSpawnImpl,
      ptySpawnImpl,
      now: () => 1_000,
      statePath,
      platform: "win32",
      env: {
        PATH: "C:\\Windows\\System32",
        USERPROFILE: path.join(tempRoot, "home"),
        APPDATA: path.join(tempRoot, "home", "AppData", "Roaming"),
        SystemRoot: "C:\\Windows",
        MAGICHAT_VISIBLE_CLI_WINDOWS: "1",
      },
    });

    manager.launchInstance({ preset: "codex" });

    expect(ptySpawnImpl).toHaveBeenCalledOnce();
    expect(mirrorSpawnImpl).toHaveBeenCalledOnce();
    const [command, args, options] = mirrorSpawnImpl.mock.calls[0];
    expect(command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(args).toContain("-NoExit");
    expect(args[args.length - 1]).toContain("MagicHat CLI - Codex CLI");
    expect(options).toEqual(
      expect.objectContaining({
        detached: true,
        windowsHide: false,
        stdio: "ignore",
      }),
    );
    expect(mirrorChild.unref).toHaveBeenCalledOnce();

    await fs.rm(tempRoot, { recursive: true, force: true });
  });
});
