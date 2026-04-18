import { describe, expect, it, vi } from "vitest";
import { BrowserControlService } from "../../host/src/operations/browserControlService.js";

// Stub Playwright page objects: we only need the handful of methods the service calls.
function fakePage({ url = "about:blank", selectors = {} } = {}) {
  const addInitScript = vi.fn(async () => {});
  const bringToFront = vi.fn(async () => {});
  const goto = vi.fn(async (u) => {
    page.url = () => u;
  });
  const evaluate = vi.fn(async () => true);

  const locator = vi.fn((selector) => {
    const matchCount = selectors[selector] ?? 0;
    return {
      first: () => ({
        count: vi.fn(async () => matchCount),
        click: vi.fn(async () => {}),
        fill: vi.fn(async () => {}),
      }),
    };
  });

  const page = {
    url: () => url,
    addInitScript,
    bringToFront,
    goto,
    evaluate,
    locator,
  };
  return page;
}

function fakeContext({ pages = [] } = {}) {
  const list = [...pages];
  return {
    pages: () => list,
    newPage: vi.fn(async () => {
      const fresh = fakePage();
      list.push(fresh);
      return fresh;
    }),
  };
}

function makeService({ pages = [] } = {}) {
  const context = fakeContext({ pages });
  const chromiumImpl = {
    launchPersistentContext: vi.fn(async () => context),
  };
  const service = new BrowserControlService({
    chromiumImpl,
    resolveExecutableImpl: async () => null,
    acquireProfileLockImpl: async () => ({ release: async () => {} }),
    userDataDir: "/tmp/never-used",
  });
  return { service, context, chromiumImpl };
}

describe("BrowserControlService.pageIdFor", () => {
  it("assigns sequential stable IDs per page object", () => {
    const { service } = makeService();
    const p1 = fakePage();
    const p2 = fakePage();
    const idA = service.pageIdFor(p1);
    const idB = service.pageIdFor(p2);
    const idAgain = service.pageIdFor(p1);
    expect(idA).toBe("page_1");
    expect(idB).toBe("page_2");
    expect(idAgain).toBe(idA);
  });

  it("auto-selects the first page whose id is requested", () => {
    const { service } = makeService();
    const p1 = fakePage();
    expect(service.selectedPageId).toBeNull();
    service.pageIdFor(p1);
    expect(service.selectedPageId).toBe("page_1");
  });
});

describe("BrowserControlService.selectPage / listPages", () => {
  it("lists pages with stable IDs and the current selection flag", async () => {
    const p1 = fakePage({ url: "https://a.example" });
    const p2 = fakePage({ url: "https://b.example" });
    const { service } = makeService({ pages: [p1, p2] });
    await service.ensureStarted();
    const listing = await service.listPages();
    expect(listing.map((entry) => entry.url)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    const selectedIds = listing.filter((entry) => entry.selected).map((e) => e.page_id);
    expect(selectedIds).toHaveLength(1);
  });

  it("rejects selectPage for an unknown id with a typed error", async () => {
    const p1 = fakePage();
    const { service } = makeService({ pages: [p1] });
    await service.ensureStarted();
    await expect(service.selectPage("page_9999")).rejects.toMatchObject({
      code: "browser_page_not_found",
    });
  });
});

describe("BrowserControlService.clickSelector / fill validation", () => {
  it("rejects empty selectors with browser_invalid_selector", async () => {
    const p1 = fakePage();
    const { service } = makeService({ pages: [p1] });
    await service.ensureStarted();
    service.selectedPageId = service.pageIdFor(p1);
    await expect(service.clickSelector("")).rejects.toMatchObject({
      code: "browser_invalid_selector",
    });
    await expect(service.fill("   ", "x")).rejects.toMatchObject({
      code: "browser_invalid_selector",
    });
  });

  it("reports browser_click_target_not_found when the locator has no matches", async () => {
    const p1 = fakePage({ selectors: { "#missing": 0 } });
    const { service } = makeService({ pages: [p1] });
    await service.ensureStarted();
    service.selectedPageId = service.pageIdFor(p1);
    await expect(service.clickSelector("#missing")).rejects.toMatchObject({
      code: "browser_click_target_not_found",
    });
  });

  it("reports browser_fill_target_not_found when the locator has no matches", async () => {
    const p1 = fakePage({ selectors: { "#missing": 0 } });
    const { service } = makeService({ pages: [p1] });
    await service.ensureStarted();
    service.selectedPageId = service.pageIdFor(p1);
    await expect(service.fill("#missing", "value")).rejects.toMatchObject({
      code: "browser_fill_target_not_found",
    });
  });
});
