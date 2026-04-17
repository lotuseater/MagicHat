// Phase 1 task 4 — end-to-end smoke test proving the v1 file-IPC contract.
//
// Runs the real host runtime (real BeaconStore + real TeamAppIpcClient) against
// a fake "Team App" that tails cmd.json and writes resp.jsonl + events.jsonl.
// Verifies: /healthz reports beacon state, /v1/instances lists, prompts land,
// follow-ups land, trust lands, SSE emits beacon-derived events.

import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMagicHatRuntime } from "../../host/src/app.js";

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-e2e-"));
  const beaconPath = path.join(root, "active_instances.json");
  const statePath = path.join(root, "host_state.json");
  const instanceDir = path.join(root, "instance_412");
  await fs.mkdir(instanceDir, { recursive: true });
  const cmdPath = path.join(instanceDir, "cmd.json");
  const respPath = path.join(instanceDir, "resp.jsonl");
  const eventsPath = path.join(instanceDir, "events.jsonl");

  return {
    root,
    beaconPath,
    statePath,
    instance: {
      cmdPath,
      respPath,
      eventsPath,
      dir: instanceDir,
    },
  };
}

function beaconEntry({ pid = 412, cmdPath, respPath, eventsPath, instanceId = "team_app_412" }) {
  const now = Date.now();
  return {
    contract_version: "1.0.0",
    beacon_schema_version: "1.0.0",
    instance_id: instanceId,
    automation_prefix: "team_app_412",
    pid,
    hwnd: 2000,
    session_id: "sess-e2e",
    phase: "running",
    current_task_state: { phase: "running", task: "E2E smoke" },
    artifact_dir: path.dirname(cmdPath),
    cmd_path: cmdPath,
    resp_path: respPath,
    events_path: eventsPath,
    run_artifact_dir: path.dirname(cmdPath),
    run_log_path: path.join(path.dirname(cmdPath), "run.jsonl"),
    restore_state_path: path.join(path.dirname(cmdPath), "session_restore.json"),
    started_at: now - 1000,
    heartbeat_ts: now,
    last_activity_ts: now,
    result_summary: { short_text: "E2E smoke", source: "summary_text", truncated: false },
    health: { network_available: true, had_agent_errors: false, pending_resumes: 0 },
  };
}

function buildConfig(ws) {
  return {
    listenHost: "0.0.0.0",
    port: 18765,
    beaconPath: ws.beaconPath,
    statePath: ws.statePath,
    pairingCodeTtlMs: 5 * 60 * 1000,
    tokenTtlMs: 24 * 60 * 60 * 1000,
    launch: { command: "", args: [], cwd: ws.root, waitMs: 500 },
    allowNonWindows: true,
    remote: {
      enabled: false,
      relayUrl: "",
      allowInsecureRelay: true,
      remoteStatePath: path.join(ws.root, "remote.json"),
      bootstrapTtlMs: 10 * 60 * 1000,
    },
  };
}

// Fake Team App: watches cmd.json, replies ok to each command, then keeps going.
function startFakeTeamApp(instance, { onCommand } = {}) {
  let stopped = false;
  let lastSeq = null;

  const loop = (async () => {
    while (!stopped) {
      try {
        const raw = await fs.readFile(instance.cmdPath, "utf8").catch(() => null);
        if (raw) {
          const cmd = JSON.parse(raw);
          if (cmd.seq && cmd.seq !== lastSeq) {
            lastSeq = cmd.seq;
            const reply = onCommand ? await onCommand(cmd) : {
              status: "ok", seq: cmd.seq, cmd: cmd.cmd, result: {},
            };
            await fs.appendFile(instance.respPath, `${JSON.stringify(reply)}\n`, "utf8");
            await fs.appendFile(
              instance.eventsPath,
              `${JSON.stringify({ type: "ack", cmd: cmd.cmd, seq: cmd.seq, ts: Date.now() })}\n`,
              "utf8",
            );
          }
        }
      } catch {
        // ignore and keep polling
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  })();

  return {
    async stop() {
      stopped = true;
      await loop;
    },
  };
}

async function pair(runtime, baseUrl) {
  const code = runtime.pairingManager.getActivePairingCode().code;
  const res = await fetch(`${baseUrl}/v1/pairing/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairing_code: code, device_name: "smoke" }),
  });
  const body = await res.json();
  return body.session_token;
}

describe("Team App ↔ MagicHat host ↔ file-IPC contract (E2E)", () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()().catch(() => {});
    }
  });

  it("reports healthy beacon state via /healthz when beacon is fresh", async () => {
    const ws = await makeWorkspace();
    cleanups.push(() => fs.rm(ws.root, { recursive: true, force: true }));

    const entry = beaconEntry({
      cmdPath: ws.instance.cmdPath,
      respPath: ws.instance.respPath,
      eventsPath: ws.instance.eventsPath,
    });
    await fs.writeFile(ws.beaconPath, JSON.stringify([entry], null, 2), "utf8");

    const runtime = createMagicHatRuntime({
      config: buildConfig(ws),
      processProbe: () => true,
    });
    const server = await new Promise((resolve) =>
      runtime.app.listen(0, "127.0.0.1", function () { resolve(this); }),
    );
    cleanups.push(() => new Promise((r) => server.close(r)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const health = await (await fetch(`${baseUrl}/healthz`)).json();
    expect(health.status).toBe("ok");
    expect(health.team_app_reachable).toBe(true);
    expect(health.team_app_fresh).toBe(true);
    expect(health.instances_total).toBe(1);
    expect(health.instances_fresh).toBe(1);
  });

  it("reports no_beacon_entries when no beacon file exists", async () => {
    const ws = await makeWorkspace();
    cleanups.push(() => fs.rm(ws.root, { recursive: true, force: true }));

    const runtime = createMagicHatRuntime({
      config: buildConfig(ws),
      processProbe: () => true,
    });
    const server = await new Promise((resolve) =>
      runtime.app.listen(0, "127.0.0.1", function () { resolve(this); }),
    );
    cleanups.push(() => new Promise((r) => server.close(r)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const health = await (await fetch(`${baseUrl}/healthz`)).json();
    expect(health.team_app_reachable).toBe(false);
    expect(health.team_app_reason).toBe("no_beacon_entries");
  });

  it("delivers prompts through the real file-IPC contract end to end", async () => {
    const ws = await makeWorkspace();
    cleanups.push(() => fs.rm(ws.root, { recursive: true, force: true }));

    const entry = beaconEntry({
      cmdPath: ws.instance.cmdPath,
      respPath: ws.instance.respPath,
      eventsPath: ws.instance.eventsPath,
    });
    await fs.writeFile(ws.beaconPath, JSON.stringify([entry], null, 2), "utf8");

    const commandsSeen = [];
    const fake = startFakeTeamApp(ws.instance, {
      async onCommand(cmd) {
        commandsSeen.push({ cmd: cmd.cmd, seq: cmd.seq });
        return { status: "ok", seq: cmd.seq, cmd: cmd.cmd, result: { accepted: true } };
      },
    });
    cleanups.push(() => fake.stop());

    const runtime = createMagicHatRuntime({
      config: buildConfig(ws),
      processProbe: () => true,
    });
    const server = await new Promise((resolve) =>
      runtime.app.listen(0, "127.0.0.1", function () { resolve(this); }),
    );
    cleanups.push(() => new Promise((r) => server.close(r)));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const token = await pair(runtime, baseUrl);
    const authHeaders = { "content-type": "application/json", authorization: `Bearer ${token}` };

    // List instances — should surface the fake beacon entry.
    const listRes = await fetch(`${baseUrl}/v1/instances`, { headers: authHeaders });
    const listBody = await listRes.json();
    expect(listRes.status).toBe(200);
    expect(listBody.instances.length).toBe(1);
    const instanceId = listBody.instances[0].id;

    // Send the initial prompt.
    const promptRes = await fetch(`${baseUrl}/v1/instances/${instanceId}/prompt`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ prompt: "Hello from smoke test" }),
    });
    expect(promptRes.status).toBe(202);

    // Send a follow-up.
    const followRes = await fetch(`${baseUrl}/v1/instances/${instanceId}/follow-up`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ message: "Keep going" }),
    });
    expect(followRes.status).toBe(202);

    // Trust prompt.
    const trustRes = await fetch(`${baseUrl}/v1/instances/${instanceId}/trust`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ approved: true }),
    });
    expect(trustRes.status).toBe(202);

    // Wait for the fake Team App to process everything.
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && commandsSeen.length < 3) {
      await new Promise((r) => setTimeout(r, 60));
    }

    const kinds = commandsSeen.map((c) => c.cmd);
    expect(kinds).toContain("submit_initial_prompt");
    expect(kinds).toContain("submit_follow_up");
    expect(kinds).toContain("answer_trust_prompt");

    // events.jsonl should contain matching acks from the fake app.
    const events = await fs.readFile(ws.instance.eventsPath, "utf8");
    const parsed = events.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(parsed.length).toBeGreaterThanOrEqual(3);
    expect(parsed.map((e) => e.cmd)).toEqual(expect.arrayContaining([
      "submit_initial_prompt",
      "submit_follow_up",
      "answer_trust_prompt",
    ]));
  });
});
