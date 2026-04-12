#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHostServer } from "../../host/src/server.js";
import { startRelayServer } from "../../relay/src/server.js";

function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function waitFor(fn, timeoutMs = 8000) {
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

async function requestJson(method, url, { body, token } = {}) {
  const headers = {};
  let payload = undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    method,
    headers,
    body: payload,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function openEventStream(url, token) {
  return fetch(url, {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
    },
  });
}

async function readSseUntil(reader, predicate, timeoutMs = 8000) {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    if (predicate(buffer)) {
      return buffer;
    }
  }
  throw new Error("timeout_waiting_for_sse_event");
}

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
      task: "Remote smoke task",
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
      short_text: "Worker swarm active",
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

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-remote-smoke-"));
  const beaconPath = path.join(root, "active_instances.json");
  const statePath = path.join(root, "host_state.json");
  await fs.writeFile(beaconPath, `${JSON.stringify([buildBeaconEntry()], null, 2)}\n`, "utf8");
  return {
    root,
    beaconPath,
    statePath,
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
        cwd: root,
        waitMs: 500,
      },
      allowNonWindows: true,
      remote: {
        enabled: true,
        relayUrl: "",
        allowInsecureRelay: true,
        remoteStatePath: path.join(root, "remote_state.json"),
        bootstrapTtlMs: 10 * 60 * 1000,
      },
    },
  };
}

async function pairRemoteDevice({ relayPort, hostBaseUrl, deviceName = "Remote Smoke Phone" }) {
  const bootstrap = await requestJson("POST", `${hostBaseUrl}/admin/v2/remote/bootstrap`);
  if (bootstrap.status !== 200) {
    throw new Error(`bootstrap_failed:${bootstrap.status}`);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  const claim = await requestJson("POST", `http://127.0.0.1:${relayPort}/v2/mobile/pair/bootstrap/claim`, {
    body: {
      bootstrap_token: bootstrap.body.bootstrap_token,
      device_name: deviceName,
      platform: "android",
      device_public_key: publicKeyBase64,
    },
  });
  if (claim.status !== 202) {
    throw new Error(`claim_failed:${claim.status}`);
  }

  await waitFor(async () => {
    const response = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/pending-devices`);
    return response.body.pending_approvals.find((entry) => entry.claim_id === claim.body.claim_id) || null;
  });

  const approved = await requestJson(
    "POST",
    `${hostBaseUrl}/admin/v2/remote/pending-devices/${claim.body.claim_id}/approve`,
  );
  if (approved.status !== 200) {
    throw new Error(`approve_failed:${approved.status}`);
  }

  const approvedClaim = await waitFor(async () => {
    const response = await requestJson(
      "GET",
      `http://127.0.0.1:${relayPort}/v2/mobile/pair/bootstrap/claims/${claim.body.claim_id}`,
    );
    return response.body?.status === "approved" ? response.body : null;
  });

  const signature = crypto.sign(
    null,
    Buffer.from(approvedClaim.challenge, "utf8"),
    privateKey,
  );

  const registration = await requestJson("POST", `http://127.0.0.1:${relayPort}/v2/mobile/pair/device/register`, {
    body: {
      claim_id: claim.body.claim_id,
      challenge: approvedClaim.challenge,
      signature: base64UrlEncode(signature),
    },
  });
  if (registration.status !== 201) {
    throw new Error(`register_failed:${registration.status}`);
  }
  return registration.body;
}

function logStep(message, detail = "") {
  const suffix = detail ? `: ${detail}` : "";
  console.log(`[remote-smoke] ${message}${suffix}`);
}

const cleanups = [];

async function main() {
  const workspace = await createWorkspace();
  cleanups.push(async () => {
    await fs.rm(workspace.root, { recursive: true, force: true });
  });

  const relayRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-smoke-"));
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
      requestTimeoutMs: 5000,
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
  const relayPort = relay.server.address().port;
  logStep("relay_started", `http://127.0.0.1:${relayPort}`);

  const sendCommand = async (_instance, payload) => ({
    status: "ok",
    cmd: payload.cmd,
    snapshot: { phase: "running" },
  });

  const host = await startHostServer({
    allowNonWindows: true,
    config: {
      ...workspace.config,
      remote: {
        ...workspace.config.remote,
        relayUrl: `http://127.0.0.1:${relayPort}`,
      },
    },
    processProbe: () => true,
    ipcClient: {
      inspect: async () => ({
        status: "ok",
        snapshot: {
          phase: "running",
          task_state: { task: "Remote smoke task", workers_done: 1 },
          trust_status: "prompt_required",
          pending_trust_project: "MagicHat",
        },
        summary_text: "Remote smoke summary",
        terminals_by_agent: { erasmus: "ready" },
        chat: [{ role: "assistant", text: "Remote smoke summary" }],
      }),
      sendCommand,
      tailEvents: async () => ({
        source: "events",
        events: [{ type: "message", message: "worker finished" }],
        next_cursor: 1,
      }),
    },
    lifecycleManager: {
      launchInstance: async () => buildBeaconEntry({ pid: 999, instance_id: "wizard_team_app_999_2000" }),
      closeInstance: async () => ({ status: "queued" }),
    },
  });
  cleanups.push(async () => {
    await host.close();
  });
  const hostBaseUrl = `http://127.0.0.1:${host.server.address().port}`;
  logStep("host_started", hostBaseUrl);

  await waitFor(async () => {
    const status = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/status`);
    return status.body?.relay?.connected ? status.body : null;
  });
  logStep("host_connected_to_relay");

  const registration = await pairRemoteDevice({ relayPort, hostBaseUrl });
  logStep("device_paired", registration.device_id);

  const token = registration.access_token;
  const hostId = registration.host_id;

  const hosts = await requestJson("GET", `http://127.0.0.1:${relayPort}/v2/mobile/hosts`, { token });
  logStep("hosts_listed", `${hosts.body.hosts.length} host(s)`);

  const instances = await requestJson(
    "GET",
    `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/instances`,
    { token },
  );
  const instanceId = instances.body.instances[0].instance_id;
  logStep("instances_listed", `${instanceId} ${instances.body.instances[0].restore_ref}`);

  const restoreRefs = await requestJson(
    "GET",
    `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/restore-refs`,
    { token },
  );
  const restoreRef = restoreRefs.body.restore_refs[0].restore_ref;
  logStep("restore_refs_listed", restoreRef);

  const launched = await requestJson(
    "POST",
    `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/instances`,
    {
      token,
      body: { title: "Remote smoke launch", restore_ref: restoreRef },
    },
  );
  logStep("instance_launched", launched.body.instance_id);

  const prompted = await requestJson(
    "POST",
    `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/instances/${instanceId}/prompt`,
    {
      token,
      body: { prompt: "Write a short summary of current blockers." },
    },
  );
  logStep("prompt_sent", prompted.body.status);

  const followUp = await requestJson(
    "POST",
    `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/instances/${instanceId}/follow-up`,
    {
      token,
      body: { message: "Now propose the smallest next fix." },
    },
  );
  logStep("follow_up_sent", followUp.body.status);

  const trusted = await requestJson(
    "POST",
    `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/instances/${instanceId}/trust`,
    {
      token,
      body: { approved: true },
    },
  );
  logStep("trust_answered", trusted.body.status);

  const stream = await openEventStream(
    `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/instances/${instanceId}/updates`,
    token,
  );
  const reader = stream.body.getReader();
  const firstChunk = await readSseUntil(reader, (text) => text.includes("event: instance_update"));
  logStep("updates_streamed", firstChunk.includes("worker finished") ? "worker finished" : "event received");
  await reader.cancel();

  const closed = await requestJson(
    "DELETE",
    `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/instances/${instanceId}`,
    { token },
  );
  logStep("instance_closed", closed.body.status);

  const devices = await requestJson("GET", `http://127.0.0.1:${relayPort}/v2/mobile/devices`, { token });
  const deviceId = devices.body.devices[0].device_id;
  logStep("devices_listed", deviceId);

  const revoked = await requestJson(
    "DELETE",
    `http://127.0.0.1:${relayPort}/v2/mobile/devices/${deviceId}`,
    { token },
  );
  logStep("device_revoked", revoked.body.status);

  const revokedAccess = await requestJson("GET", `http://127.0.0.1:${relayPort}/v2/mobile/hosts`, {
    token,
  });
  if (revokedAccess.status !== 401) {
    throw new Error(`expected_revoked_access_401_got_${revokedAccess.status}`);
  }
  logStep("access_revoked_confirmed");
  logStep("success");
}

try {
  await main();
} finally {
  while (cleanups.length > 0) {
    try {
      await cleanups.pop()();
    } catch {}
  }
}
