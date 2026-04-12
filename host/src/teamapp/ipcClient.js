import fs from "node:fs/promises";

function parseJsonLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "non_json_line", raw: line };
      }
    });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commandErrorFromResponse(response) {
  const error = new Error(
    response?.error?.message || response?.msg || response?.error?.code || "command_failed",
  );
  error.code = response?.error?.code || "command_failed";
  error.response = response;
  return error;
}

export class TeamAppIpcClient {
  constructor(options = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 120;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
    this.seqCounter = 0;
  }

  _nextSeq() {
    this.seqCounter += 1;
    return Date.now() * 100 + this.seqCounter;
  }

  async sendCommand(instance, command, options = {}) {
    if (!instance?.cmd_path || !instance?.resp_path) {
      throw new Error("missing_ipc_paths");
    }

    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const seq = options.seq ?? this._nextSeq();
    const payload = { ...command, seq };

    await fs.writeFile(instance.cmd_path, JSON.stringify(payload), "utf8");

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await fileExists(instance.resp_path)) {
        try {
          const content = await fs.readFile(instance.resp_path, "utf8");
          const lines = parseJsonLines(content);
          const match = lines.find((line) => line?.seq === seq);
          if (match) {
            if (options.requireOk && match?.status && match.status !== "ok") {
              throw commandErrorFromResponse(match);
            }
            return match;
          }
        } catch {
          // Keep polling until timeout.
        }
      }
      await sleep(this.pollIntervalMs);
    }

    throw new Error("ipc_response_timeout");
  }

  async inspect(instance, options = {}) {
    return this.sendCommand(
      instance,
      {
        cmd: "inspect",
        include_chat: options.include_chat ?? true,
        include_summary: options.include_summary ?? true,
        include_terminals: options.include_terminals ?? true,
      },
      { timeoutMs: 10000 },
    );
  }

  async tailEvents(instance, cursor = 0) {
    const normalizedCursor = Number.isFinite(Number(cursor)) ? Math.max(Number(cursor), 0) : 0;

    if (instance.events_path && (await fileExists(instance.events_path))) {
      const content = await fs.readFile(instance.events_path, "utf8");
      const parsed = parseJsonLines(content);
      const boundedCursor = Math.min(normalizedCursor, parsed.length);
      return {
        source: "events",
        events: parsed.slice(boundedCursor),
        next_cursor: parsed.length,
      };
    }

    const inspect = await this.inspect(instance);
    return {
      source: "inspect",
      events: [{ type: "inspect_snapshot", payload: inspect }],
      next_cursor: normalizedCursor + 1,
    };
  }
}
