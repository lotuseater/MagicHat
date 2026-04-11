import fs from "node:fs/promises";
import path from "node:path";

function normalizeEntry(entry) {
  const pid = Number.parseInt(entry?.pid, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return null;
  }

  return {
    contract_version: entry.contract_version || "",
    beacon_schema_version: entry.beacon_schema_version || "",
    instance_id: entry.instance_id || "",
    automation_prefix: entry.automation_prefix || "",
    pid,
    hwnd: entry.hwnd ?? null,
    session_id: entry.session_id || "",
    phase: entry.phase || "",
    current_task_state:
      entry.current_task_state && typeof entry.current_task_state === "object"
        ? entry.current_task_state
        : {},
    artifact_dir: entry.artifact_dir || "",
    cmd_path: entry.cmd_path || "",
    resp_path: entry.resp_path || "",
    events_path: entry.events_path || "",
    run_artifact_dir: entry.run_artifact_dir || "",
    run_log_path: entry.run_log_path || "",
    restore_state_path: entry.restore_state_path || "",
    started_at: entry.started_at || null,
    heartbeat_ts: entry.heartbeat_ts || null,
    last_activity_ts: entry.last_activity_ts || null,
    result_summary:
      entry.result_summary && typeof entry.result_summary === "object"
        ? entry.result_summary
        : {},
    health:
      entry.health && typeof entry.health === "object"
        ? entry.health
        : {},
  };
}

function toPublicInstance(entry) {
  return {
    id: entry.instance_id || String(entry.pid),
    contract_version: entry.contract_version,
    beacon_schema_version: entry.beacon_schema_version,
    instance_id: entry.instance_id,
    automation_prefix: entry.automation_prefix,
    pid: entry.pid,
    hwnd: entry.hwnd,
    session_id: entry.session_id,
    phase: entry.phase,
    current_task_state: entry.current_task_state,
    artifact_dir: entry.artifact_dir,
    cmd_path: entry.cmd_path,
    resp_path: entry.resp_path,
    events_path: entry.events_path,
    run_artifact_dir: entry.run_artifact_dir,
    run_log_path: entry.run_log_path,
    restore_state_path: entry.restore_state_path,
    started_at: entry.started_at,
    heartbeat_ts: entry.heartbeat_ts,
    last_activity_ts: entry.last_activity_ts,
    result_summary: entry.result_summary,
    health: entry.health,
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class BeaconStore {
  constructor({ beaconPath, processProbe }) {
    this.beaconPath = beaconPath;
    this.processProbe = processProbe || ((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  }

  async _readRawArray() {
    if (!(await fileExists(this.beaconPath))) {
      return [];
    }

    try {
      const raw = await fs.readFile(this.beaconPath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async _writeRawArray(entries) {
    await fs.mkdir(path.dirname(this.beaconPath), { recursive: true });
    await fs.writeFile(this.beaconPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  }

  async _isEntryAlive(entry) {
    if (!entry.cmd_path || !entry.resp_path) {
      return false;
    }

    return this.processProbe(entry.pid);
  }

  async pruneStaleEntries() {
    const raw = await this._readRawArray();
    const normalized = raw.map(normalizeEntry).filter(Boolean);

    const alive = [];
    for (const entry of normalized) {
      // The beacon contract requires pid + cmd/resp paths for a live instance.
      if (await this._isEntryAlive(entry)) {
        alive.push(entry);
      }
    }

    await this._writeRawArray(alive);
    return {
      kept: alive.length,
      removed: normalized.length - alive.length,
    };
  }

  async listInstances() {
    await this.pruneStaleEntries();
    const entries = (await this._readRawArray()).map(normalizeEntry).filter(Boolean);
    entries.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
    return entries.map(toPublicInstance);
  }

  async listInternalInstances() {
    await this.pruneStaleEntries();
    return (await this._readRawArray()).map(normalizeEntry).filter(Boolean);
  }

  async getInstanceById(id) {
    const stringId = String(id);
    const entries = await this.listInternalInstances();
    return (
      entries.find(
        (entry) => String(entry.pid) === stringId || entry.instance_id === stringId,
      ) || null
    );
  }

  toPublicInstance(entry) {
    return toPublicInstance(entry);
  }

  async waitForNewInstance(knownPids, options = {}) {
    const timeoutMs = options.timeoutMs ?? 15000;
    const pollMs = options.pollMs ?? 250;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const entries = await this.listInternalInstances();
      const found = entries.find((entry) => !knownPids.has(entry.pid));
      if (found) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error("timeout_waiting_for_new_instance");
  }
}
