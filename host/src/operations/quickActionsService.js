import { spawn } from "node:child_process";

function normalizeUrl(input) {
  const raw = `${input || ""}`.trim();
  if (!raw) {
    const error = new Error("quick_action_invalid_url");
    error.code = "quick_action_invalid_url";
    throw error;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return raw;
  }

  return `https://${raw}`;
}

function buildSearchUrl(query, engine = "google") {
  const trimmed = `${query || ""}`.trim();
  if (!trimmed) {
    const error = new Error("quick_action_missing_query");
    error.code = "quick_action_missing_query";
    throw error;
  }

  const encoded = encodeURIComponent(trimmed);
  switch (`${engine || "google"}`.trim().toLowerCase()) {
    case "youtube":
      return `https://www.youtube.com/results?search_query=${encoded}`;
    case "duckduckgo":
    case "ddg":
      return `https://duckduckgo.com/?q=${encoded}`;
    case "bing":
      return `https://www.bing.com/search?q=${encoded}`;
    case "google":
    default:
      return `https://www.google.com/search?q=${encoded}`;
  }
}

function defaultOpenExternal(url) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  }

  if (process.platform === "darwin") {
    return spawn("open", [url], {
      detached: true,
      stdio: "ignore",
    });
  }

  return spawn("xdg-open", [url], {
    detached: true,
    stdio: "ignore",
  });
}

function defaultLaunch(command, args = [], options = {}) {
  return spawn(command, args, {
    cwd: options.cwd || process.cwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    shell: false,
  });
}

function trimmedArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => `${value ?? ""}`.trim())
    .filter((value) => value.length > 0);
}

function tokenizeCommand(text) {
  const tokens = [];
  const input = `${text || ""}`;
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens.filter((token) => token.length > 0);
}

export class QuickActionsService {
  constructor(options = {}) {
    this.openExternalImpl = options.openExternalImpl || defaultOpenExternal;
    this.launchImpl = options.launchImpl || defaultLaunch;
    this.browserControlService = options.browserControlService || null;
  }

  listActions() {
    return [
      {
        kind: "open_url",
        label: "Open URL",
        description: "Open a URL in the default browser immediately.",
      },
      {
        kind: "web_search",
        label: "Web Search",
        description: "Run a search in Google, Bing, DuckDuckGo, or YouTube.",
      },
      {
        kind: "launch_app",
        label: "Launch App",
        description: "Start a local desktop application or command directly on the host.",
      },
      {
        kind: "hook_syntax",
        label: "Hook Syntax",
        description: "Use /host open <url>, /host search <query>, /host app <command> [args...], or /host browser ... in a Team App prompt.",
      },
      {
        kind: "browser_open",
        label: "Browser Open",
        description: "Open a URL in a persistent browser session managed by the host.",
      },
      {
        kind: "browser_search",
        label: "Browser Search",
        description: "Open a search query in the persistent browser session.",
      },
      {
        kind: "browser_list_pages",
        label: "Browser Pages",
        description: "List pages currently open in the persistent browser session.",
      },
      {
        kind: "browser_select_page",
        label: "Browser Select Page",
        description: "Select one open browser page as the active target.",
      },
      {
        kind: "browser_click_text",
        label: "Browser Click Text",
        description: "Click the first visible element containing the provided text on the active page.",
      },
      {
        kind: "browser_click_selector",
        label: "Browser Click Selector",
        description: "Click the first element matching a CSS selector on the active page.",
      },
      {
        kind: "browser_fill",
        label: "Browser Fill",
        description: "Fill the first element matching a CSS selector on the active page.",
      },
      {
        kind: "browser_snapshot",
        label: "Browser Snapshot",
        description: "Return a compact snapshot of the active page.",
      },
    ];
  }

  parseHookText(text) {
    const trimmed = `${text || ""}`.trim();
    if (!trimmed.toLowerCase().startsWith("/host ")) {
      return null;
    }

    const tokens = tokenizeCommand(trimmed);
    if (tokens.length < 3) {
      const error = new Error("quick_action_unsupported");
      error.code = "quick_action_unsupported";
      throw error;
    }

    const [, verb, ...rest] = tokens;
    switch (verb.toLowerCase()) {
      case "browser": {
        const subcommand = `${rest[0] || ""}`.toLowerCase();
        const args = rest.slice(1);
        switch (subcommand) {
          case "open":
            return { kind: "browser_open", url: args.join(" ") };
          case "search": {
            const enginePrefixes = new Set(["google", "bing", "duckduckgo", "ddg", "youtube"]);
            const first = `${args[0] || ""}`.toLowerCase();
            if (enginePrefixes.has(first) && args.length > 1) {
              return { kind: "browser_search", engine: first, query: args.slice(1).join(" ") };
            }
            return { kind: "browser_search", query: args.join(" ") };
          }
          case "list":
          case "pages":
            return { kind: "browser_list_pages" };
          case "select":
            return { kind: "browser_select_page", page_id: args[0] || "" };
          case "click":
            return { kind: "browser_click_text", text: args.join(" ") };
          case "click-selector":
          case "clickselector":
            return { kind: "browser_click_selector", selector: args.join(" ") };
          case "fill":
            return { kind: "browser_fill", selector: args[0] || "", value: args.slice(1).join(" ") };
          case "snapshot":
            return { kind: "browser_snapshot" };
          default: {
            const error = new Error("quick_action_unsupported");
            error.code = "quick_action_unsupported";
            throw error;
          }
        }
      }
      case "open":
      case "url":
        return { kind: "open_url", url: rest.join(" ") };
      case "search": {
        const enginePrefixes = new Set(["google", "bing", "duckduckgo", "ddg", "youtube"]);
        const first = `${rest[0] || ""}`.toLowerCase();
        if (enginePrefixes.has(first) && rest.length > 1) {
          return { kind: "web_search", engine: first, query: rest.slice(1).join(" ") };
        }
        return { kind: "web_search", query: rest.join(" ") };
      }
      case "app":
      case "run":
      case "launch":
        return {
          kind: "launch_app",
          command: rest[0] || "",
          args: rest.slice(1),
        };
      default: {
        const error = new Error("quick_action_unsupported");
        error.code = "quick_action_unsupported";
        throw error;
      }
    }
  }

  async execute(action = {}) {
    const kind = `${action.kind || ""}`.trim().toLowerCase();
    switch (kind) {
      case "open_url":
        return this.openUrl(action.url);
      case "web_search":
        return this.webSearch(action.query, action.engine);
      case "launch_app":
        return this.launchApp(action.command, action.args, action.cwd);
      case "browser_open":
        return this.browserOpen(action.url);
      case "browser_search":
        return this.browserSearch(action.query, action.engine);
      case "browser_list_pages":
        return this.browserListPages();
      case "browser_select_page":
        return this.browserSelectPage(action.page_id || action.pageId);
      case "browser_click_text":
        return this.browserClickText(action.text);
      case "browser_click_selector":
        return this.browserClickSelector(action.selector);
      case "browser_fill":
        return this.browserFill(action.selector, action.value);
      case "browser_snapshot":
        return this.browserSnapshot();
      default: {
        const error = new Error("quick_action_unsupported");
        error.code = "quick_action_unsupported";
        throw error;
      }
    }
  }

  async executeHookText(text) {
    const action = this.parseHookText(text);
    if (!action) {
      return null;
    }
    return await this.execute(action);
  }

  requireBrowserControlService() {
    if (!this.browserControlService) {
      const error = new Error("browser_control_unavailable");
      error.code = "browser_control_unavailable";
      throw error;
    }
    return this.browserControlService;
  }

  async browserOpen(url) {
    return await this.requireBrowserControlService().openUrl(normalizeUrl(url), { newPage: true });
  }

  async browserSearch(query, engine) {
    return await this.requireBrowserControlService().search(query, engine);
  }

  async browserListPages() {
    return { status: "ok", pages: await this.requireBrowserControlService().listPages() };
  }

  async browserSelectPage(pageId) {
    return await this.requireBrowserControlService().selectPage(`${pageId || ""}`.trim());
  }

  async browserClickText(text) {
    return await this.requireBrowserControlService().clickText(`${text || ""}`.trim());
  }

  async browserClickSelector(selector) {
    return await this.requireBrowserControlService().clickSelector(selector);
  }

  async browserFill(selector, value) {
    return await this.requireBrowserControlService().fill(selector, value);
  }

  async browserSnapshot() {
    const snapshot = await this.requireBrowserControlService().snapshot();
    return { status: "ok", snapshot };
  }

  openUrl(url) {
    const normalized = normalizeUrl(url);
    const child = this.openExternalImpl(normalized);
    child?.unref?.();
    return {
      status: "launched",
      kind: "open_url",
      target: normalized,
    };
  }

  webSearch(query, engine) {
    const url = buildSearchUrl(query, engine);
    const child = this.openExternalImpl(url);
    child?.unref?.();
    return {
      status: "launched",
      kind: "web_search",
      target: url,
      engine: `${engine || "google"}`.trim().toLowerCase() || "google",
    };
  }

  launchApp(command, args, cwd) {
    const trimmed = `${command || ""}`.trim();
    if (!trimmed) {
      const error = new Error("quick_action_missing_command");
      error.code = "quick_action_missing_command";
      throw error;
    }

    const child = this.launchImpl(trimmed, trimmedArray(args), { cwd });
    child?.unref?.();
    return {
      status: "launched",
      kind: "launch_app",
      command: trimmed,
      args: trimmedArray(args),
      cwd: `${cwd || ""}`.trim() || undefined,
      pid: Number.isFinite(child?.pid) ? child.pid : undefined,
    };
  }
}

export { buildSearchUrl, normalizeUrl };
