import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntime, pairDevice } from "./_helpers.js";
import { QuickActionsService } from "../../host/src/operations/quickActionsService.js";

describe("/v1/quick-actions", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      await contexts.pop().cleanup();
    }
  });

  it("lists supported fast actions", async () => {
    const ctx = await createRuntime();
    contexts.push(ctx);

    const token = await pairDevice(ctx);
    const response = await ctx.http.get("/v1/quick-actions", { token });

    expect(response.status).toBe(200);
    expect(response.body.actions.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["open_url", "web_search", "launch_app"]),
    );
  });

  it("executes browser and app shortcuts without Team App IPC", async () => {
    const openExternalImpl = vi.fn(() => ({ pid: 321, unref: vi.fn() }));
    const launchImpl = vi.fn(() => ({ pid: 654, unref: vi.fn() }));

    const ctx = await createRuntime({
      quickActionsService: new QuickActionsService({
        openExternalImpl,
        launchImpl,
      }),
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);

    const openUrl = await ctx.http.post("/v1/quick-actions", {
      token,
      body: { kind: "open_url", url: "youtube.com" },
    });
    expect(openUrl.status).toBe(202);
    expect(openUrl.body.target).toBe("https://youtube.com");
    expect(openExternalImpl).toHaveBeenCalledWith("https://youtube.com");

    const webSearch = await ctx.http.post("/v1/quick-actions", {
      token,
      body: { kind: "web_search", engine: "youtube", query: "lofi beats" },
    });
    expect(webSearch.status).toBe(202);
    expect(webSearch.body.target).toBe("https://www.youtube.com/results?search_query=lofi%20beats");

    const launchApp = await ctx.http.post("/v1/quick-actions", {
      token,
      body: { kind: "launch_app", command: "notepad.exe", args: ["notes.txt"] },
    });
    expect(launchApp.status).toBe(202);
    expect(launchApp.body.command).toBe("notepad.exe");
    expect(launchImpl).toHaveBeenCalledWith("notepad.exe", ["notes.txt"], { cwd: undefined });
  });

  it("returns 400 for malformed fast actions", async () => {
    const ctx = await createRuntime();
    contexts.push(ctx);

    const token = await pairDevice(ctx);
    const response = await ctx.http.post("/v1/quick-actions", {
      token,
      body: { kind: "web_search", query: "" },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("quick_action_missing_query");
  });

  it("routes browser actions through the persistent browser service", async () => {
    const browserControlService = {
      listPages: vi.fn(async () => [
        { page_id: "page_1", url: "https://example.com", title: "Example", selected: true },
      ]),
      openUrl: vi.fn(async (url) => ({ status: "ok", page_id: "page_2", url })),
      search: vi.fn(async (query, engine) => ({ status: "ok", page_id: "page_3", query, engine })),
      selectPage: vi.fn(async (pageId) => ({ status: "selected", page_id: pageId })),
      clickText: vi.fn(async (text) => ({ status: "ok", clicked: true, text })),
      clickSelector: vi.fn(async (selector) => ({ status: "ok", clicked: true, selector })),
      fill: vi.fn(async (selector, value) => ({ status: "ok", filled: true, selector, value })),
      snapshot: vi.fn(async () => ({ title: "Example", url: "https://example.com" })),
    };

    const ctx = await createRuntime({ browserControlService });
    contexts.push(ctx);
    const token = await pairDevice(ctx);

    const pages = await ctx.http.get("/v1/browser/pages", { token });
    expect(pages.status).toBe(200);
    expect(browserControlService.listPages).toHaveBeenCalledTimes(1);

    const open = await ctx.http.post("/v1/browser/actions", {
      token,
      body: { kind: "browser_open", url: "https://youtube.com" },
    });
    expect(open.status).toBe(202);
    expect(browserControlService.openUrl).toHaveBeenCalledWith("https://youtube.com", { newPage: true });

    const click = await ctx.http.post("/v1/browser/actions", {
      token,
      body: { kind: "browser_click_text", text: "Subscriptions" },
    });
    expect(click.status).toBe(202);
    expect(browserControlService.clickText).toHaveBeenCalledWith("Subscriptions");

    const fill = await ctx.http.post("/v1/browser/actions", {
      token,
      body: { kind: "browser_fill", selector: "input[name='search_query']", value: "lofi" },
    });
    expect(fill.status).toBe(202);
    expect(browserControlService.fill).toHaveBeenCalledWith("input[name='search_query']", "lofi");
  });
});
