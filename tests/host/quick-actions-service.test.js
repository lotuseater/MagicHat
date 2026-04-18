import { describe, expect, it, vi } from "vitest";
import { QuickActionsService } from "../../host/src/operations/quickActionsService.js";

function makeService(overrides = {}) {
  const openExternalImpl = vi.fn(() => ({ unref: vi.fn() }));
  const launchImpl = vi.fn(() => ({ unref: vi.fn() }));
  const service = new QuickActionsService({
    openExternalImpl,
    launchImpl,
    ...overrides,
  });
  return { service, openExternalImpl, launchImpl };
}

describe("QuickActionsService.openUrl", () => {
  it("adds https:// when a bare host is passed", () => {
    const { service, openExternalImpl } = makeService();
    const result = service.openUrl("youtube.com");
    expect(result.target).toBe("https://youtube.com");
    expect(openExternalImpl).toHaveBeenCalledWith("https://youtube.com");
  });

  it("preserves an existing scheme", () => {
    const { service, openExternalImpl } = makeService();
    service.openUrl("http://192.168.1.10:8080");
    expect(openExternalImpl).toHaveBeenCalledWith("http://192.168.1.10:8080");
  });

  it("rejects empty URLs with a typed error", () => {
    const { service } = makeService();
    expect(() => service.openUrl("")).toThrowError(
      expect.objectContaining({ code: "quick_action_invalid_url" }),
    );
  });
});

describe("QuickActionsService.webSearch", () => {
  it("builds a Google search URL by default", () => {
    const { service, openExternalImpl } = makeService();
    const result = service.webSearch("vitest basics");
    expect(result.target).toBe("https://www.google.com/search?q=vitest%20basics");
    expect(result.engine).toBe("google");
    expect(openExternalImpl).toHaveBeenCalledWith(result.target);
  });

  it("routes youtube / duckduckgo / bing engines", () => {
    const { service } = makeService();
    expect(service.webSearch("kotlin flow", "youtube").target).toContain("youtube.com/results");
    expect(service.webSearch("kotlin flow", "duckduckgo").target).toContain("duckduckgo.com");
    expect(service.webSearch("kotlin flow", "ddg").target).toContain("duckduckgo.com");
    expect(service.webSearch("kotlin flow", "bing").target).toContain("bing.com");
  });

  it("rejects empty queries with a typed error", () => {
    const { service } = makeService();
    expect(() => service.webSearch("")).toThrowError(
      expect.objectContaining({ code: "quick_action_missing_query" }),
    );
  });
});

describe("QuickActionsService.launchApp", () => {
  it("spawns the given command with arg splitting + cwd", () => {
    const { service, launchImpl } = makeService();
    service.launchApp("code", ["-g", "C:/tmp/a.txt:10"], "C:/tmp");
    expect(launchImpl).toHaveBeenCalledWith(
      "code",
      ["-g", "C:/tmp/a.txt:10"],
      { cwd: "C:/tmp" },
    );
  });

  it("rejects missing command", () => {
    const { service } = makeService();
    expect(() => service.launchApp("", [])).toThrowError(
      expect.objectContaining({ code: "quick_action_missing_command" }),
    );
  });
});

describe("QuickActionsService.execute switch", () => {
  it("delegates open_url / web_search / launch_app to the matching handlers", async () => {
    const { service, openExternalImpl, launchImpl } = makeService();
    await service.execute({ kind: "open_url", url: "github.com" });
    await service.execute({ kind: "web_search", query: "next.js" });
    await service.execute({ kind: "launch_app", command: "notepad" });
    expect(openExternalImpl).toHaveBeenNthCalledWith(1, "https://github.com");
    expect(openExternalImpl).toHaveBeenNthCalledWith(2, "https://www.google.com/search?q=next.js");
    expect(launchImpl).toHaveBeenCalledWith("notepad", [], { cwd: undefined });
  });

  it("rejects unsupported action kinds with a typed error", async () => {
    const { service } = makeService();
    await expect(service.execute({ kind: "shutdown" })).rejects.toMatchObject({
      code: "quick_action_unsupported",
    });
  });
});

describe("QuickActionsService browser delegation", () => {
  it("requires a browserControlService before browser_* actions run", async () => {
    const { service } = makeService();
    await expect(service.execute({ kind: "browser_open", url: "https://a" })).rejects.toMatchObject({
      code: "browser_control_unavailable",
    });
  });

  it("forwards browser_open to BrowserControlService.openUrl with normalized URL", async () => {
    const openUrl = vi.fn(async () => ({ status: "ok", page_id: "p1", url: "https://a" }));
    const service = new QuickActionsService({
      openExternalImpl: vi.fn(() => ({ unref: vi.fn() })),
      launchImpl: vi.fn(() => ({ unref: vi.fn() })),
      browserControlService: { openUrl },
    });
    await service.execute({ kind: "browser_open", url: "a.com" });
    expect(openUrl).toHaveBeenCalledWith("https://a.com", { newPage: true });
  });

  it("forwards browser_search to BrowserControlService.search without rebuilding the URL", async () => {
    const search = vi.fn(async () => ({ status: "ok" }));
    const service = new QuickActionsService({
      openExternalImpl: vi.fn(),
      launchImpl: vi.fn(),
      browserControlService: { search },
    });
    await service.execute({ kind: "browser_search", query: "kotlin flow", engine: "ddg" });
    expect(search).toHaveBeenCalledWith("kotlin flow", "ddg");
  });
});
