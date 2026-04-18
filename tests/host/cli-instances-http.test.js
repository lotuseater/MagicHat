import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliInstancesManager } from "../../host/src/operations/cliInstancesManager.js";
import { createRuntime, pairDevice } from "./_helpers.js";

function fakeChild() {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = {
    destroyed: false,
    writableEnded: false,
    write: vi.fn(() => true),
  };
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.stdin = stdin;
  emitter.pid = 4242;
  emitter.kill = vi.fn();
  return emitter;
}

describe("/v1/cli-instances", () => {
  let ctx;

  afterEach(async () => {
    if (ctx) {
      await ctx.cleanup();
      ctx = null;
    }
  });

  it("requires a paired session token", async () => {
    const manager = new CliInstancesManager({ spawnImpl: () => fakeChild(), ptySpawnImpl: null });
    ctx = await createRuntime({ cliInstancesManager: manager });

    const unauthorized = await ctx.http.get("/v1/cli-instances");
    expect(unauthorized.status).toBe(401);
  });

  it("lists built-in presets", async () => {
    const manager = new CliInstancesManager({ spawnImpl: () => fakeChild(), ptySpawnImpl: null });
    ctx = await createRuntime({ cliInstancesManager: manager });
    const token = await pairDevice(ctx);

    const response = await ctx.http.get("/v1/cli-instances/presets", { token });
    expect(response.status).toBe(200);
    const keys = response.body.presets.map((p) => p.preset).sort();
    expect(keys).toEqual(["claude", "codex", "gemini"]);
  });

  it("launches a CLI instance and returns its summary", async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const manager = new CliInstancesManager({ spawnImpl, ptySpawnImpl: null });
    ctx = await createRuntime({ cliInstancesManager: manager });
    const token = await pairDevice(ctx);

    const response = await ctx.http.post("/v1/cli-instances", {
      token,
      body: { preset: "claude", title: "look at code", initial_prompt: "hello" },
    });

    expect(response.status).toBe(201);
    expect(response.body.preset).toBe("claude");
    expect(response.body.title).toBe("look at code");
    expect(response.body.status).toBe("running");
    expect(spawnImpl).toHaveBeenCalledOnce();
    const [command, args] = spawnImpl.mock.calls[0];
    expect(command.toLowerCase()).toContain("claude");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args[args.length - 1]).toBe("hello");
  });

  it("rejects launch without a preset", async () => {
    const manager = new CliInstancesManager({ spawnImpl: () => fakeChild(), ptySpawnImpl: null });
    ctx = await createRuntime({ cliInstancesManager: manager });
    const token = await pairDevice(ctx);

    const response = await ctx.http.post("/v1/cli-instances", {
      token,
      body: { title: "nope" },
    });
    expect(response.status).toBe(400);
  });

  it("rejects launch with an unknown preset", async () => {
    const manager = new CliInstancesManager({ spawnImpl: () => fakeChild(), ptySpawnImpl: null });
    ctx = await createRuntime({ cliInstancesManager: manager });
    const token = await pairDevice(ctx);

    const response = await ctx.http.post("/v1/cli-instances", {
      token,
      body: { preset: "bogus" },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unknown_cli_preset");
  });

  it("sends prompts over stdin to a running instance", async () => {
    const child = fakeChild();
    const manager = new CliInstancesManager({ spawnImpl: () => child, ptySpawnImpl: null });
    ctx = await createRuntime({ cliInstancesManager: manager });
    const token = await pairDevice(ctx);

    const launch = await ctx.http.post("/v1/cli-instances", {
      token,
      body: { preset: "codex" },
    });
    const id = launch.body.instance_id;

    const prompt = await ctx.http.post(`/v1/cli-instances/${id}/prompt`, {
      token,
      body: { prompt: "do the thing" },
    });
    expect(prompt.status).toBe(202);
    expect(child.stdin.write).toHaveBeenCalledWith("do the thing\n");
  });

  it("closes a running instance via DELETE", async () => {
    const child = fakeChild();
    const manager = new CliInstancesManager({ spawnImpl: () => child, ptySpawnImpl: null });
    ctx = await createRuntime({ cliInstancesManager: manager });
    const token = await pairDevice(ctx);

    const launch = await ctx.http.post("/v1/cli-instances", {
      token,
      body: { preset: "gemini" },
    });
    const id = launch.body.instance_id;

    const close = await ctx.http.delete(`/v1/cli-instances/${id}`, { token });
    expect(close.status).toBe(202);
    expect(close.body.signal).toBe("SIGTERM");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("returns 404 for unknown instance ids", async () => {
    const manager = new CliInstancesManager({ spawnImpl: () => fakeChild(), ptySpawnImpl: null });
    ctx = await createRuntime({ cliInstancesManager: manager });
    const token = await pairDevice(ctx);

    const response = await ctx.http.get("/v1/cli-instances/nope", { token });
    expect(response.status).toBe(404);
  });
});
