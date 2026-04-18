import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { buildSearchUrl } from "./quickActionsService.js";

const PAGE_HELPERS_SOURCE = String.raw`
(() => {
  if (window.__magicHatBrowserHelpers) {
    return;
  }

  const normalizeText = (value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const isVisible = (element) => {
    if (!element || !(element instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return !(
      style.visibility === "hidden" ||
      style.display === "none" ||
      rect.width === 0 ||
      rect.height === 0
    );
  };

  const getElementText = (element) =>
    normalizeText(
      [
        element.innerText,
        element.textContent,
        element.value,
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.getAttribute("title"),
        element.getAttribute("name"),
        element.getAttribute("id"),
      ]
        .filter(Boolean)
        .join(" "),
    );

  const interactiveSelectors = [
    "button",
    "a",
    "[role='button']",
    "[role='link']",
    "[aria-label]",
    "[title]",
    "div",
    "span",
  ].join(",");

  const inputSelectors = [
    "input",
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
  ].join(",");

  const dispatchValueEvents = (element) => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  const setNativeValue = (element, value) => {
    if ("value" in element) {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
      dispatchValueEvents(element);
      return true;
    }

    if (element.isContentEditable) {
      element.focus();
      element.textContent = value;
      dispatchValueEvents(element);
      return true;
    }

    return false;
  };

  const findFirst = (selectors = [], { requireVisible = true } = {}) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }
      if (!requireVisible || isVisible(element)) {
        return element;
      }
    }
    return null;
  };

  window.__magicHatBrowserHelpers = {
    snapshotPage() {
      const selectors = [
        "input",
        "textarea",
        "button",
        "[role='button']",
        "a",
        "[role='link']",
        "[contenteditable='true']",
        "[role='textbox']",
        "[role]",
        "iframe",
        "img",
        "div",
        "span",
      ];
      const seen = new Set();
      const nodes = [];
      for (const selector of selectors) {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          if (seen.has(element)) {
            continue;
          }
          seen.add(element);
          nodes.push(element);
          if (nodes.length >= 300) {
            break;
          }
        }
        if (nodes.length >= 300) {
          break;
        }
      }
      return {
        url: location.href,
        title: document.title,
        bodyText: document.body ? document.body.innerText || "" : "",
        elements: nodes.map((element) => ({
          tag: element.tagName?.toLowerCase() || "",
          text: String(element.innerText || element.textContent || ""),
          placeholder: element.getAttribute("placeholder") || "",
          ariaLabel: element.getAttribute("aria-label") || "",
          id: element.getAttribute("id") || "",
          visible: isVisible(element),
        })),
      };
    },

    clickByText(texts) {
      const normalizedTexts = texts.map(normalizeText).filter(Boolean);
      if (!normalizedTexts.length) {
        return false;
      }
      const candidates = Array.from(document.querySelectorAll(interactiveSelectors));
      for (const candidate of candidates) {
        if (!isVisible(candidate)) {
          continue;
        }
        const haystack = getElementText(candidate);
        if (normalizedTexts.some((text) => haystack.includes(text))) {
          candidate.click();
          return true;
        }
      }
      return false;
    },

    clickBySelectors(selectors) {
      const element = findFirst(selectors);
      if (!element) {
        return false;
      }
      element.click();
      return true;
    },

    fillField({ selectors = [], value = "" } = {}) {
      const element = findFirst(selectors) || findFirst(inputSelectors.split(","), { requireVisible: false });
      if (!element) {
        return false;
      }
      element.focus();
      return setNativeValue(element, value);
    },
  };
})();
`;

function normalizeCandidate(candidate) {
  if (!candidate) {
    return null;
  }
  const trimmed = String(candidate).trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function existingPath(candidate) {
  return fs.access(candidate).then(() => true).catch(() => false);
}

async function resolveBrowserExecutable() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const candidates = [
    normalizeCandidate(process.env.CHROME_PATH || process.env.MAGICHAT_BROWSER_PATH || ""),
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await existingPath(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readLockPayload(lockPath) {
  try {
    return JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

async function acquireProfileLock(userDataDir) {
  await fs.mkdir(userDataDir, { recursive: true });
  const lockPath = path.join(userDataDir, ".magichat-browser.lock.json");
  let handle;

  try {
    handle = await fs.open(lockPath, "wx");
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
    const existing = await readLockPayload(lockPath);
    if (existing?.pid && !isPidAlive(existing.pid)) {
      await fs.rm(lockPath, { force: true });
      handle = await fs.open(lockPath, "wx");
    } else {
      throw new Error(`Browser profile is already in use: ${userDataDir}`);
    }
  }

  await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2)}\n`);
  let released = false;
  return {
    async release() {
      if (released) {
        return;
      }
      released = true;
      await handle?.close().catch(() => {});
      await fs.rm(lockPath, { force: true }).catch(() => {});
    },
  };
}

function actionError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class BrowserControlService {
  constructor(options = {}) {
    this.chromiumImpl = options.chromiumImpl || chromium;
    this.resolveExecutableImpl = options.resolveExecutableImpl || resolveBrowserExecutable;
    this.acquireProfileLockImpl = options.acquireProfileLockImpl || acquireProfileLock;
    this.userDataDir = options.userDataDir ||
      path.join(os.tmpdir(), "wizard_team_app", "browser-profile");
    this.context = null;
    this.profileLock = null;
    this.pageIds = new WeakMap();
    this.nextPageId = 1;
    this.selectedPageId = null;
    this.launchPromise = null;
  }

  async ensureStarted() {
    if (this.context) {
      return this.context;
    }
    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = (async () => {
      const executablePath = await this.resolveExecutableImpl();
      const launchOptions = {
        headless: false,
        viewport: null,
        args: ["--start-maximized"],
      };
      if (executablePath) {
        launchOptions.executablePath = executablePath;
      } else {
        launchOptions.channel = "chrome";
      }

      this.profileLock = await this.acquireProfileLockImpl(this.userDataDir);
      try {
        this.context = await this.chromiumImpl.launchPersistentContext(this.userDataDir, launchOptions);
      } catch (error) {
        await this.profileLock?.release().catch(() => {});
        this.profileLock = null;
        throw error;
      }

      await this.ensurePageScript();
      return this.context;
    })();

    try {
      return await this.launchPromise;
    } finally {
      this.launchPromise = null;
    }
  }

  async ensurePageScript() {
    const pages = this.context?.pages?.() || [];
    for (const page of pages) {
      await page.addInitScript(PAGE_HELPERS_SOURCE).catch(() => {});
      this.pageIdFor(page);
    }
    if (pages.length === 0) {
      const page = await this.context.newPage();
      await page.addInitScript(PAGE_HELPERS_SOURCE).catch(() => {});
      this.pageIdFor(page);
    }
  }

  pageIdFor(page) {
    let pageId = this.pageIds.get(page);
    if (!pageId) {
      pageId = `page_${this.nextPageId++}`;
      this.pageIds.set(page, pageId);
    }
    if (!this.selectedPageId) {
      this.selectedPageId = pageId;
    }
    return pageId;
  }

  async selectedPage() {
    await this.ensureStarted();
    const pages = this.context.pages();
    for (const page of pages) {
      const pageId = this.pageIdFor(page);
      if (pageId === this.selectedPageId) {
        return page;
      }
    }
    const fallback = pages[0] || (await this.context.newPage());
    await fallback.addInitScript(PAGE_HELPERS_SOURCE).catch(() => {});
    this.selectedPageId = this.pageIdFor(fallback);
    return fallback;
  }

  async listPages() {
    await this.ensureStarted();
    return this.context.pages().map((page) => ({
      page_id: this.pageIdFor(page),
      url: page.url(),
      title: page.url(),
      selected: this.pageIdFor(page) === this.selectedPageId,
    }));
  }

  async selectPage(pageId) {
    await this.ensureStarted();
    const match = this.context.pages().find((page) => this.pageIdFor(page) === pageId);
    if (!match) {
      throw actionError("browser_page_not_found");
    }
    this.selectedPageId = pageId;
    await match.bringToFront().catch(() => {});
    return { status: "selected", page_id: pageId, url: match.url() };
  }

  async openUrl(url, { newPage = true } = {}) {
    await this.ensureStarted();
    const page = newPage ? await this.context.newPage() : await this.selectedPage();
    await page.addInitScript(PAGE_HELPERS_SOURCE).catch(() => {});
    const pageId = this.pageIdFor(page);
    this.selectedPageId = pageId;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.bringToFront().catch(() => {});
    return { status: "ok", page_id: pageId, url: page.url() };
  }

  async search(query, engine) {
    return this.openUrl(buildSearchUrl(query, engine), { newPage: true });
  }

  async clickText(text) {
    const page = await this.selectedPage();
    const values = Array.isArray(text) ? text : [`${text || ""}`];
    const clicked = await page.evaluate((texts) => {
      return window.__magicHatBrowserHelpers?.clickByText(texts) || false;
    }, values);
    if (!clicked) {
      throw actionError("browser_click_target_not_found");
    }
    return { status: "ok", clicked: true, text: values.join(" | ") };
  }

  async clickSelector(selector) {
    const page = await this.selectedPage();
    const trimmed = `${selector || ""}`.trim();
    if (!trimmed) {
      throw actionError("browser_invalid_selector");
    }
    const locator = page.locator(trimmed).first();
    const count = await locator.count();
    if (!count) {
      throw actionError("browser_click_target_not_found");
    }
    await locator.click({ timeout: 10_000 });
    return { status: "ok", clicked: true, selector: trimmed };
  }

  async fill(selector, value) {
    const page = await this.selectedPage();
    const trimmed = `${selector || ""}`.trim();
    if (!trimmed) {
      throw actionError("browser_invalid_selector");
    }
    const locator = page.locator(trimmed).first();
    const count = await locator.count();
    if (!count) {
      throw actionError("browser_fill_target_not_found");
    }
    await locator.fill(`${value || ""}`, { timeout: 10_000 });
    return { status: "ok", filled: true, selector: trimmed };
  }

  async snapshot() {
    const page = await this.selectedPage();
    return await page.evaluate(() => window.__magicHatBrowserHelpers?.snapshotPage() || null);
  }
}
