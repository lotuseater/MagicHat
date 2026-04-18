import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBeaconEntry, createRuntime, pairDevice } from "./_helpers.js";
import { QuickActionsService } from "../../host/src/operations/quickActionsService.js";

describe("endpoint command mapping", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      await contexts.pop().cleanup();
    }
  });

  it("maps prompt, trust, and restore endpoints to existing Team App IPC commands", async () => {
    const sendCommand = vi.fn(async (_instance, payload) => ({
      status: "ok",
      seq: 11,
      cmd: payload.cmd,
    }));

    const ctx = await createRuntime({
      beaconEntries: [buildBeaconEntry({ pid: 412 })],
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand,
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999 })),
        closeInstance: vi.fn(async () => ({ pid: 412, closed: true, graceful: true })),
      },
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);

    const initial = await ctx.http.post("/v1/instances/412/prompt", {
      token,
      body: { prompt: "Build status update" },
    });
    expect(initial.status).toBe(202);

    const follow = await ctx.http.post("/v1/instances/412/follow-up", {
      token,
      body: { message: "Continue with QA" },
    });
    expect(follow.status).toBe(202);

    const trust = await ctx.http.post("/v1/instances/412/trust", {
      token,
      body: { approved: true },
    });
    expect(trust.status).toBe(202);

    const restore = await ctx.http.post("/v1/instances/412/restore", {
      token,
      body: { restore_state_path: "C:/tmp/session_restore.json" },
    });
    expect(restore.status).toBe(202);

    expect(sendCommand.mock.calls[0][1].cmd).toBe("submit_initial_prompt");
    expect(sendCommand.mock.calls[1][1].cmd).toBe("submit_follow_up");
    expect(sendCommand.mock.calls[2][1].cmd).toBe("answer_trust_prompt");
    expect(sendCommand.mock.calls[2][1].approved).toBe(true);
    expect(sendCommand.mock.calls[3][1].cmd).toBe("restore_session");
  });

  it("surfaces Team App IPC failures instead of returning queued success", async () => {
    const sendCommand = vi.fn(async () => {
      const error = new Error("submit_initial_prompt is not implemented");
      error.code = "not_supported";
      throw error;
    });

    const ctx = await createRuntime({
      beaconEntries: [buildBeaconEntry({ pid: 412 })],
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand,
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999 })),
        closeInstance: vi.fn(async () => ({ pid: 412, closed: true, graceful: true })),
      },
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);

    const initial = await ctx.http.post("/v1/instances/412/prompt", {
      token,
      body: { prompt: "Build status update" },
    });
    expect(initial.status).toBe(500);
    expect(initial.body.error).toBe("not_supported");
  });

  it("routes explicit /host shortcut prompts to quick actions instead of Team App IPC", async () => {
    const sendCommand = vi.fn(async (_instance, payload) => ({
      status: "ok",
      seq: 11,
      cmd: payload.cmd,
    }));
    const openExternalImpl = vi.fn(() => ({ pid: 111, unref: vi.fn() }));
    const launchImpl = vi.fn(() => ({ pid: 222, unref: vi.fn() }));

    const ctx = await createRuntime({
      beaconEntries: [buildBeaconEntry({ pid: 412 })],
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand,
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999 })),
        closeInstance: vi.fn(async () => ({ pid: 412, closed: true, graceful: true })),
      },
      quickActionsService: new QuickActionsService({
        openExternalImpl,
        launchImpl,
      }),
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);

    const open = await ctx.http.post("/v1/instances/412/follow-up", {
      token,
      body: { message: "/host open https://youtube.com" },
    });
    expect(open.status).toBe(202);
    expect(openExternalImpl).toHaveBeenCalledWith("https://youtube.com");

    const search = await ctx.http.post("/v1/instances/412/prompt", {
      token,
      body: { prompt: "/host search youtube lofi mix" },
    });
    expect(search.status).toBe(202);
    expect(openExternalImpl).toHaveBeenCalledWith("https://www.youtube.com/results?search_query=lofi%20mix");

    const app = await ctx.http.post("/v1/instances/412/follow-up", {
      token,
      body: { message: "/host app notepad.exe notes.txt" },
    });
    expect(app.status).toBe(202);
    expect(launchImpl).toHaveBeenCalledWith("notepad.exe", ["notes.txt"], { cwd: undefined });

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("routes explicit /host browser hooks to browser control instead of Team App IPC", async () => {
    const sendCommand = vi.fn(async (_instance, payload) => ({
      status: "ok",
      seq: 11,
      cmd: payload.cmd,
    }));
    const browserControlService = {
      listPages: vi.fn(async () => [{ page_id: "page_1", url: "https://example.com", selected: true }]),
      openUrl: vi.fn(async (url) => ({ status: "ok", page_id: "page_2", url })),
      search: vi.fn(async (query, engine) => ({ status: "ok", query, engine })),
      selectPage: vi.fn(async (pageId) => ({ status: "selected", page_id: pageId })),
      clickText: vi.fn(async (text) => ({ status: "ok", text })),
      clickSelector: vi.fn(async (selector) => ({ status: "ok", selector })),
      fill: vi.fn(async (selector, value) => ({ status: "ok", selector, value })),
      snapshot: vi.fn(async () => ({ title: "Example" })),
    };

    const ctx = await createRuntime({
      beaconEntries: [buildBeaconEntry({ pid: 412 })],
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand,
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999 })),
        closeInstance: vi.fn(async () => ({ pid: 412, closed: true, graceful: true })),
      },
      browserControlService,
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);

    const open = await ctx.http.post("/v1/instances/412/follow-up", {
      token,
      body: { message: "/host browser open https://youtube.com" },
    });
    expect(open.status).toBe(202);
    expect(browserControlService.openUrl).toHaveBeenCalledWith("https://youtube.com", { newPage: true });

    const click = await ctx.http.post("/v1/instances/412/follow-up", {
      token,
      body: { message: "/host browser click \"Subscriptions\"" },
    });
    expect(click.status).toBe(202);
    expect(browserControlService.clickText).toHaveBeenCalledWith("Subscriptions");

    const fill = await ctx.http.post("/v1/instances/412/prompt", {
      token,
      body: { prompt: "/host browser fill \"input[name='search_query']\" \"lofi mix\"" },
    });
    expect(fill.status).toBe(202);
    expect(browserControlService.fill).toHaveBeenCalledWith("input[name='search_query']", "lofi mix");

    const snapshot = await ctx.http.post("/v1/instances/412/follow-up", {
      token,
      body: { message: "/host browser snapshot" },
    });
    expect(snapshot.status).toBe(202);
    expect(browserControlService.snapshot).toHaveBeenCalledTimes(1);

    expect(sendCommand).not.toHaveBeenCalled();
  });
});
