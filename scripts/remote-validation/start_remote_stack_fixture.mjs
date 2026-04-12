#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHostServer } from "../../host/src/server.js";
import { startRelayServer } from "../../relay/src/server.js";

function nowMs() {
  return Date.now();
}

function buildBeaconEntry(overrides = {}) {
  return {
    contract_version: "1.0.0",
    beacon_schema_version: "1.0.0",
    instance_id: "wizard_team_app_101_1000",
    automation_prefix: "wizard_team_app",
    pid: 412,
    hwnd: 200,
    session_id: "session-alpha",
    phase: "running",
    current_task_state: {
      phase: "running",
      task: "Remote fixture task",
      workers_done: 1,
      pending_resumes: 0,
      review_round: 0,
      oversight_round: 0,
    },
    artifact_dir: "C:/tmp/artifacts",
    cmd_path: "C:/tmp/cmd.json",
    resp_path: "C:/tmp/resp.jsonl",
    events_path: "C:/tmp/events.jsonl",
    run_artifact_dir: "C:/tmp/run",
    run_log_path: "C:/tmp/run/team_app_run.jsonl",
    restore_state_path: "C:/runs/session-alpha/session_restore.json",
    started_at: nowMs() - 5_000,
    heartbeat_ts: nowMs(),
    last_activity_ts: nowMs(),
    result_summary: {
      short_text: "Remote fixture summary",
      source: "summary_text",
      truncated: false,
    },
    health: {
      network_available: true,
      had_agent_errors: false,
      pending_resumes: 0,
    },
    ...overrides,
  };
}

async function waitFor(fn, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("timeout_waiting_for_condition");
}

async function requestJson(method, url) {
  const response = await fetch(url, { method });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function writeBeacon(beaconPath, instances) {
  await fs.writeFile(beaconPath, `${JSON.stringify(instances, null, 2)}\n`, "utf8");
}

const cleanups = [];
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  while (cleanups.length > 0) {
    try {
      await cleanups.pop()();
    } catch {}
  }
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

try {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-remote-fixture-"));
  cleanups.push(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  const beaconPath = path.join(workspaceRoot, "active_instances.json");
  const statePath = path.join(workspaceRoot, "host_state.json");
  const liveInstances = [buildBeaconEntry()];
  await writeBeacon(beaconPath, liveInstances);

  const relayRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-fixture-"));
  cleanups.push(async () => {
    await fs.rm(relayRoot, { recursive: true, force: true });
  });

  const relay = await startRelayServer({
    config: {
      listenHost: "127.0.0.1",
      port: 0,
      allowInsecureHttp: true,
      database: {
        kind: "sqlite",
        sqlitePath: path.join(relayRoot, "relay.sqlite"),
      },
      accessTokenTtlMs: 15 * 60 * 1000,
      refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
      bootstrapTokenTtlMs: 10 * 60 * 1000,
      heartbeatTimeoutMs: 60 * 1000,
      requestTimeoutMs: 5_000,
      rateLimitWindowMs: 60 * 1000,
      bootstrapClaimLimit: 20,
      refreshLimit: 60,
      commandLimit: 120,
      tls: {
        certPath: "",
        keyPath: "",
      },
    },
  });
  cleanups.push(async () => {
    await relay.close();
  });

  const relayUrl = `http://127.0.0.1:${relay.server.address().port}`;

  const host = await startHostServer({
    allowNonWindows: true,
    config: {
      listenHost: "127.0.0.1",
      port: 0,
      beaconPath,
      pairingCodeTtlMs: 5 * 60 * 1000,
      tokenTtlMs: 24 * 60 * 60 * 1000,
      statePath,
      launch: {
        command: "team-app.exe",
        args: [],
        cwd: workspaceRoot,
        waitMs: 500,
      },
      allowNonWindows: true,
      remote: {
        enabled: true,
        relayUrl,
        allowInsecureRelay: true,
        remoteStatePath: path.join(workspaceRoot, "remote_state.json"),
        bootstrapTtlMs: 10 * 60 * 1000,
      },
    },
    processProbe: () => true,
      ipcClient: {
      inspect: async () => ({
        status: "ok",
        snapshot: {
          phase: "running",
          task_state: { task: "Remote fixture task", workers_done: 1 },
          trust_status: "prompt_required",
          pending_trust_project: "MagicHat",
        },
        summary_text: "Remote fixture summary",
        terminals_by_agent: { erasmus: "ready" },
        chat: [{ role: "assistant", text: "Remote fixture summary" }],
      }),
      sendCommand: async (_instance, payload) => ({
        status: "ok",
        cmd: payload.cmd,
      }),
      tailEvents: async () => ({
        source: "events",
        events: [{ type: "message", message: "worker finished" }],
        next_cursor: 1,
      }),
      },
      lifecycleManager: {
      launchInstance: async () => {
        const launched = buildBeaconEntry({
          pid: 999,
          instance_id: "wizard_team_app_999_2000",
          session_id: "session-restored",
          restore_state_path: "C:/runs/session-restored/session_restore.json",
          started_at: nowMs(),
          current_task_state: {
            phase: "running",
            task: "Restored remote fixture task",
            workers_done: 0,
            pending_resumes: 0,
            review_round: 0,
            oversight_round: 0,
          },
        });
        const existingIndex = liveInstances.findIndex((entry) => entry.instance_id === launched.instance_id);
        if (existingIndex >= 0) {
          liveInstances.splice(existingIndex, 1, launched);
        } else {
          liveInstances.push(launched);
        }
        await writeBeacon(beaconPath, liveInstances);
        return launched;
      },
      closeInstance: async (instance) => {
        const nextInstances = liveInstances.filter((entry) => entry.instance_id !== instance.instance_id);
        liveInstances.splice(0, liveInstances.length, ...nextInstances);
        await writeBeacon(beaconPath, liveInstances);
        return { status: "queued" };
      },
      },
    });
  cleanups.push(async () => {
    await host.close();
  });

  const hostBaseUrl = `http://127.0.0.1:${host.server.address().port}`;

  await waitFor(async () => {
    const status = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/status`);
    return status.body?.relay?.connected ? status.body : null;
  });

  const autoApproveInterval = setInterval(async () => {
    try {
      const pending = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/pending-devices`);
      for (const approval of pending.body?.pending_approvals || []) {
        await requestJson("POST", `${hostBaseUrl}/admin/v2/remote/pending-devices/${approval.claim_id}/approve`);
      }
    } catch {}
  }, 250);
  cleanups.push(async () => {
    clearInterval(autoApproveInterval);
  });

  process.stdout.write(`${JSON.stringify({ relay_url: relayUrl, host_base_url: hostBaseUrl })}\n`);
  await new Promise(() => {});
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  await shutdown();
  process.exit(1);
}
