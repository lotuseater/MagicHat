import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMagicHatRuntime } from "../../host/src/app.js";

export async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-host-test-"));
  const beaconPath = path.join(root, "active_instances.json");
  const statePath = path.join(root, "host_state.json");

  return {
    root,
    beaconPath,
    statePath,
    config: {
      listenHost: "0.0.0.0",
      port: 18765,
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
        enabled: false,
        relayUrl: "",
        allowInsecureRelay: true,
        remoteStatePath: path.join(root, "magichat_remote_state.json"),
        bootstrapTtlMs: 10 * 60 * 1000,
      },
    },
  };
}

export async function writeBeacon(beaconPath, entries) {
  await fs.writeFile(beaconPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

export async function createRuntime(options = {}) {
  const workspace = options.workspace || (await createWorkspace());

  if (options.beaconEntries) {
    await writeBeacon(workspace.beaconPath, options.beaconEntries);
  }

  const runtime = createMagicHatRuntime({
    config: workspace.config,
    processProbe: options.processProbe,
    ipcClient: options.ipcClient,
    lifecycleManager: options.lifecycleManager,
    processController: options.processController,
    lanGuardOptions: options.lanGuardOptions,
  });

  const server = await new Promise((resolve, reject) => {
    const instance = runtime.app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(method, pathname, reqOptions = {}) {
    const headers = { ...(reqOptions.headers || {}) };
    if (reqOptions.token) {
      headers.Authorization = `Bearer ${reqOptions.token}`;
    }
    let body;
    if (reqOptions.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(reqOptions.body);
    }

    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body,
    });

    const text = await response.text();
    let parsedBody = null;
    try {
      parsedBody = text ? JSON.parse(text) : null;
    } catch {
      parsedBody = null;
    }

    return {
      status: response.status,
      text,
      body: parsedBody,
      headers: Object.fromEntries(response.headers.entries()),
    };
  }

  return {
    workspace,
    runtime,
    http: {
      request,
      get(pathname, reqOptions = {}) {
        return request("GET", pathname, reqOptions);
      },
      post(pathname, reqOptions = {}) {
        return request("POST", pathname, reqOptions);
      },
    },
    async cleanup() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await fs.rm(workspace.root, { recursive: true, force: true });
    },
  };
}

export async function pairDevice(context, deviceName = "pixel") {
  const pairingCode = context.runtime.pairingManager.getActivePairingCode().code;
  const complete = await context.http.post("/v1/pairing/session", {
    body: {
      pairing_code: pairingCode,
      device_name: deviceName,
    },
  });
  return complete.body.session_token;
}

export function buildBeaconEntry(overrides = {}) {
  return {
    contract_version: "1.0.0",
    beacon_schema_version: "1.0.0",
    instance_id: "wizard_team_app_101_1000",
    automation_prefix: "wizard_team_app",
    pid: 101,
    hwnd: 200,
    session_id: "session-a",
    phase: "running",
    current_task_state: {
      phase: "running",
      task: "Investigate MagicHat",
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
    restore_state_path: "C:/tmp/run/session_restore.json",
    started_at: 1000,
    heartbeat_ts: 1100,
    last_activity_ts: 1150,
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
