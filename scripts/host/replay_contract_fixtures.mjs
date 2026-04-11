#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createMagicHatRuntime } from "../../host/src/app.js";

function parseArgs(argv) {
  const options = {
    fixturesDir: path.resolve(process.cwd(), "../tests/contracts"),
    allowMissing: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--fixtures" && argv[i + 1]) {
      options.fixturesDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (value === "--allow-missing") {
      options.allowMissing = true;
    }
  }

  return options;
}

async function collectJsonFiles(rootDir) {
  const results = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        results.push(full);
      }
    }
  }

  await walk(rootDir);
  return results.sort();
}

function getByPath(obj, dottedPath) {
  return dottedPath.split(".").reduce((acc, key) => {
    if (acc === null || acc === undefined) {
      return undefined;
    }
    return acc[key];
  }, obj);
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function validateContractLock(contract, filePath) {
  const serialized = JSON.stringify(contract);
  const requiredMarkers = [
    "pid",
    "hwnd",
    "cmd_path",
    "resp_path",
    "events_path",
    "inspect",
    "run_log_path",
  ];

  for (const marker of requiredMarkers) {
    assert(
      serialized.includes(marker),
      `${filePath}: contract lock missing marker '${marker}'`,
    );
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function startReplayRuntime() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-contract-replay-"));
  const beaconPath = path.join(tempRoot, "active_instances.json");
  const statePath = path.join(tempRoot, "host_state.json");

  await writeJson(beaconPath, [
    {
      pid: 41,
      hwnd: 91,
      session_id: "fixture-session",
      artifact_dir: "C:/tmp/fixture-artifacts",
      cmd_path: "C:/tmp/fixture_cmd.json",
      resp_path: "C:/tmp/fixture_resp.jsonl",
      events_path: "C:/tmp/fixture_events.jsonl",
      run_artifact_dir: "C:/tmp/fixture_run",
      started_at: Date.now(),
    },
  ]);

  const runtime = createMagicHatRuntime({
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
        cwd: tempRoot,
        waitMs: 300,
      },
      allowNonWindows: true,
    },
    processProbe: () => true,
    ipcClient: {
      inspect: async () => ({ status: "ok", snapshot: { phase: "running" } }),
      sendCommand: async (_instance, payload) => ({ status: "ok", seq: 1, cmd: payload.cmd }),
      tailEvents: async (_instance, cursor) => ({
        source: "events",
        events: cursor > 0 ? [] : [{ type: "tick", status: "running" }],
        next_cursor: cursor > 0 ? cursor : 1,
      }),
    },
    lifecycleManager: {
      launchInstance: async () => ({
        pid: 55,
        hwnd: 66,
        session_id: "launched",
        artifact_dir: "C:/tmp/launched",
        cmd_path: "C:/tmp/launched_cmd.json",
        resp_path: "C:/tmp/launched_resp.jsonl",
        events_path: "C:/tmp/launched_events.jsonl",
        run_artifact_dir: "C:/tmp/launched_run",
        started_at: Date.now(),
      }),
      closeInstance: async (instance) => ({ pid: instance.pid, closed: true, graceful: true }),
    },
  });

  const server = await new Promise((resolve, reject) => {
    const s = runtime.app.listen(0, "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function pair() {
    const done = await fetch(`${baseUrl}/v1/pairing/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairing_code: runtime.pairing_code,
        device_name: "contract-bot",
      }),
    });
    const doneJson = await done.json();
    return doneJson.session_token;
  }

  return {
    baseUrl,
    token: await pair(),
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function replayHttpFixture(filePath, fixture, replayRuntime) {
  const requestShape = fixture.request || fixture;
  const expectShape = fixture.expect || {};
  const method = (requestShape.method || "GET").toUpperCase();
  const pathName = requestShape.path;

  assert(pathName && pathName.startsWith("/"), `${filePath}: missing request.path`);

  const headers = {};
  if (requestShape.auth !== false) {
    headers.Authorization = `Bearer ${replayRuntime.token}`;
  }

  if (requestShape.headers && typeof requestShape.headers === "object") {
    Object.assign(headers, requestShape.headers);
  }

  let body;
  if (requestShape.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(requestShape.body);
  }

  const response = await fetch(`${replayRuntime.baseUrl}${pathName}`, {
    method,
    headers,
    body,
  });

  const responseText = await response.text();
  let json;
  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch {
    json = null;
  }

  if (expectShape.status !== undefined) {
    assert(
      response.status === expectShape.status,
      `${filePath}: expected status ${expectShape.status}, got ${response.status}`,
    );
  }

  for (const dottedPath of expectShape.required_json_paths || []) {
    assert(
      getByPath(json, dottedPath) !== undefined,
      `${filePath}: missing required_json_path '${dottedPath}'`,
    );
  }

  if (expectShape.equals && typeof expectShape.equals === "object") {
    for (const [dottedPath, expectedValue] of Object.entries(expectShape.equals)) {
      const actual = getByPath(json, dottedPath);
      assert(
        JSON.stringify(actual) === JSON.stringify(expectedValue),
        `${filePath}: expected ${dottedPath}=${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let fixtureFiles = [];
  try {
    fixtureFiles = await collectJsonFiles(options.fixturesDir);
  } catch (error) {
    if (options.allowMissing) {
      console.log(`Skipping contract replay: fixtures directory missing (${options.fixturesDir}).`);
      return;
    }
    throw error;
  }

  if (fixtureFiles.length === 0) {
    if (options.allowMissing) {
      console.log(`Skipping contract replay: no fixtures in ${options.fixturesDir}.`);
      return;
    }
    throw new Error(`no_contract_fixtures_found in ${options.fixturesDir}`);
  }

  const runtime = await startReplayRuntime();
  let replayed = 0;

  try {
    for (const filePath of fixtureFiles) {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      const fileName = path.basename(filePath);

      if (fileName === "contract_lock.json") {
        validateContractLock(parsed, filePath);
        replayed += 1;
        continue;
      }

      if (parsed.request || (parsed.path && parsed.method)) {
        await replayHttpFixture(filePath, parsed, runtime);
        replayed += 1;
        continue;
      }

      throw new Error(`${filePath}: unsupported fixture schema`);
    }
  } finally {
    await runtime.close();
  }

  console.log(`Contract replay passed for ${replayed} fixture file(s).`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
