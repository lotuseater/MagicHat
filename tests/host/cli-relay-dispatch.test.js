import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CliInstancesManager } from "../../host/src/operations/cliInstancesManager.js";

function fakeChild() {
  const emitter = new EventEmitter();
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.stdin = { destroyed: false, writableEnded: false, write: vi.fn(() => true) };
  emitter.pid = 4242;
  emitter.kill = vi.fn();
  return emitter;
}

// Helper that drives the manager the same way the host's commandHandler switch does.
function runCliCommand(manager, kind, params, context) {
  switch (kind) {
    case "list_cli_presets":
      return { presets: manager.listPresets() };
    case "list_cli_instances":
      return { instances: manager.listInstances() };
    case "launch_cli_instance":
      return manager.launchInstance({
        preset: params.preset,
        title: params.title,
        initialPrompt: params.initial_prompt,
        extraArgs: Array.isArray(params.extra_args) ? params.extra_args : undefined,
      });
    case "get_cli_instance":
      return manager.getInstance(params.instance_id);
    case "close_cli_instance":
      return manager.closeInstance(params.instance_id, { force: !!params.force });
    case "send_cli_prompt":
      return manager.sendPrompt(params.instance_id, params.prompt);
    case "subscribe_cli_updates": {
      const stop = manager.observeInstance(params.instance_id, {
        sinceTs: 0,
        onEvent: (event) => context.sendUpdate({
          subscription_id: params.subscription_id,
          instance_id: params.instance_id,
          event,
        }),
      });
      return { status: "subscribed", stop };
    }
    default:
      throw new Error(`unsupported:${kind}`);
  }
}

describe("CLI relay command dispatch", () => {
  it("routes launch/send/close through the manager and forwards events to sendUpdate", async () => {
    const child = fakeChild();
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-cli-relay-"));
    const manager = new CliInstancesManager({
      spawnImpl: () => child,
      ptySpawnImpl: null,
      now: () => 1,
      statePath: path.join(tempRoot, "cli_instances.json"),
    });
    const sendUpdate = vi.fn();
    const context = { sendUpdate };

    const presets = runCliCommand(manager, "list_cli_presets");
    expect(presets.presets.map((p) => p.preset).sort()).toEqual(["claude", "codex", "gemini"]);

    const launched = runCliCommand(manager, "launch_cli_instance", {
      preset: "claude",
      title: "ping",
      initial_prompt: "hello",
    });
    expect(launched.status).toBe("running");
    expect(launched.preset).toBe("claude");

    const listed = runCliCommand(manager, "list_cli_instances");
    expect(listed.instances).toHaveLength(1);

    const sub = runCliCommand(manager, "subscribe_cli_updates", {
      subscription_id: "sub-1",
      instance_id: launched.instance_id,
    }, context);
    expect(sub.status).toBe("subscribed");

    child.stdout.emit("data", Buffer.from("tick"));
    expect(sendUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_id: "sub-1",
        instance_id: launched.instance_id,
        event: expect.objectContaining({ source: "stdout", chunk: "tick" }),
      }),
    );

    runCliCommand(manager, "send_cli_prompt", {
      instance_id: launched.instance_id,
      prompt: "next",
    });
    expect(child.stdin.write).toHaveBeenLastCalledWith("next\n");

    const closed = runCliCommand(manager, "close_cli_instance", {
      instance_id: launched.instance_id,
    });
    expect(closed.status).toBe("closing");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await fs.rm(tempRoot, { recursive: true, force: true });
  });
});
