import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  beforeEach(() => {
    child = fakeChild();
    spawnImpl = vi.fn(() => child);
    manager = new CliInstancesManager({ spawnImpl, now: () => 1_000 });
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
    expect(spawnImpl).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--dangerously-skip-permissions", "--permission-mode", "plan"]),
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
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
});
