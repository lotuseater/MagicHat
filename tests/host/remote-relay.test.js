import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startHostServer } from "../../host/src/server.js";
import { startRelayServer } from "../../relay/src/server.js";
import { CliInstancesManager } from "../../host/src/operations/cliInstancesManager.js";
import { buildBeaconEntry, createWorkspace, writeBeacon } from "./_helpers.js";

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

async function pairRemoteDevice({ relayPort, hostBaseUrl, deviceName = "Remote Test Phone" }) {
  const bootstrap = await requestJson("POST", `${hostBaseUrl}/admin/v2/remote/bootstrap`);
  expect(bootstrap.status).toBe(200);
  expect(bootstrap.body.pair_uri).toContain("magichat://pair");
  expect(bootstrap.body.qr_svg).toContain("<svg");

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
  expect(claim.status).toBe(202);

  const pending = await waitFor(async () => {
    const response = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/pending-devices`);
    return response.body.pending_approvals.find((entry) => entry.claim_id === claim.body.claim_id) || null;
  });
  expect(pending.device_name).toBe(deviceName);

  const approved = await requestJson(
    "POST",
    `${hostBaseUrl}/admin/v2/remote/pending-devices/${claim.body.claim_id}/approve`,
  );
  expect(approved.status).toBe(200);

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
  expect(registration.status).toBe(201);
  expect(registration.body.host_name).toBeTruthy();

  return {
    bootstrap,
    claim,
    registration,
  };
}

async function openEventStream(url, token) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "text/event-stream",
    },
  });
  expect(response.status).toBe(200);
  expect(response.body).toBeTruthy();
  return response;
}

async function readSseUntil(reader, matcher, timeoutMs = 8000) {
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = "";

  while (Date.now() < deadline) {
    const remainingMs = Math.max(deadline - Date.now(), 1);
    const chunk = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout_waiting_for_sse")), remainingMs)),
    ]);
    if (chunk.done) {
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    if (matcher(buffer)) {
      return buffer;
    }
  }

  throw new Error("timeout_waiting_for_sse");
}

function fakeCliChild() {
  const emitter = new EventEmitter();
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.stdin = {
    destroyed: false,
    writableEnded: false,
    write: vi.fn(() => true),
  };
  emitter.pid = 7331;
  emitter.kill = vi.fn();
  return emitter;
}

describe("remote relay integration", () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()();
    }
  });

  it("pairs remotely and forwards instance commands through relay and host", async () => {
    const workspace = await createWorkspace();
    await writeBeacon(workspace.beaconPath, [buildBeaconEntry({ pid: 412, restore_state_path: "C:/runs/session-alpha/session_restore.json" })]);

    const relayRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-test-"));
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
      },
    });
    cleanups.push(async () => {
      await relay.close();
      await fs.rm(relayRoot, { recursive: true, force: true });
    });
    const relayPort = relay.server.address().port;

    const sendCommand = vi.fn(async (_instance, payload) => ({
      status: "ok",
      cmd: payload.cmd,
      snapshot: { phase: "running" },
    }));
    const closeInstance = vi.fn(async () => ({ status: "queued" }));
    const host = await startHostServer({
      allowNonWindows: true,
      config: {
        ...workspace.config,
        listenHost: "127.0.0.1",
        port: 0,
        remote: {
          enabled: true,
          relayUrl: `http://127.0.0.1:${relayPort}`,
          allowInsecureRelay: true,
          remoteStatePath: path.join(workspace.root, "remote_state.json"),
          bootstrapTtlMs: 10 * 60 * 1000,
        },
      },
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({
          status: "ok",
          snapshot: { phase: "running", task_state: { task: "Remote task", workers_done: 1 } },
          summary_text: "Remote summary",
          terminals_by_agent: { erasmus: "ready" },
          chat: [{ role: "assistant", text: "Remote summary" }],
        })),
        sendCommand,
        tailEvents: vi.fn(async () => ({
          source: "events",
          events: [{ type: "message", message: "worker finished" }],
          next_cursor: 1,
        })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999, instance_id: "wizard_team_app_999_2000" })),
        closeInstance,
      },
    });
    cleanups.push(async () => {
      await host.close();
      await fs.rm(workspace.root, { recursive: true, force: true });
    });
    const hostPort = host.server.address().port;
    const hostBaseUrl = `http://127.0.0.1:${hostPort}`;

    await waitFor(async () => {
      const status = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/status`);
      return status.body?.relay?.connected ? status.body : null;
    });

    const { registration } = await pairRemoteDevice({
      relayPort,
      hostBaseUrl,
    });

    const accessToken = registration.body.access_token;
    const originalRefreshToken = registration.body.refresh_token;
    const devices = await requestJson("GET", `http://127.0.0.1:${relayPort}/v2/mobile/devices`, {
      token: accessToken,
    });
    expect(devices.status).toBe(200);
    expect(devices.body.devices).toHaveLength(1);
    expect(devices.body.devices[0].device_name).toBe("Remote Test Phone");

    const hosts = await requestJson("GET", `http://127.0.0.1:${relayPort}/v2/mobile/hosts`, {
      token: accessToken,
    });
    expect(hosts.status).toBe(200);
    expect(hosts.body.hosts[0].status).toBe("online");

    const instances = await requestJson(
      "GET",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${registration.body.host_id}/instances`,
      { token: accessToken },
    );
    expect(instances.status).toBe(200);
    expect(instances.body.instances[0].instance_id).toBe("wizard_team_app_101_1000");
    expect(instances.body.instances[0].cmd_path).toBeUndefined();
    expect(instances.body.instances[0].restore_ref).toMatch(/^restore_/);

    const restoreRefs = await requestJson(
      "GET",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${registration.body.host_id}/restore-refs`,
      { token: accessToken },
    );
    expect(restoreRefs.status).toBe(200);
    expect(restoreRefs.body.restore_refs[0].restore_ref).toMatch(/^restore_/);

    const launch = await requestJson(
      "POST",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${registration.body.host_id}/instances`,
      {
        token: accessToken,
        body: {
          title: "Remote launch",
          restore_ref: restoreRefs.body.restore_refs[0].restore_ref,
          team_mode: "full",
          launcher_preset: "codex",
          fenrus_launcher: "default",
        },
      },
    );
    expect(launch.status).toBe(201);
    expect(host.runtime.lifecycleManager.launchInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "Remote launch",
        startupProfile: {
          team_mode: "full",
          launcher_preset: "codex",
          fenrus_launcher: "default",
        },
      }),
    );
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 999 }),
      expect.objectContaining({ cmd: "restore_session", path: "C:/runs/session-alpha/session_restore.json" }),
      expect.objectContaining({ requireOk: true }),
    );

    const prompt = await requestJson(
      "POST",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${registration.body.host_id}/instances/wizard_team_app_101_1000/prompt`,
      {
        token: accessToken,
        body: { prompt: "Continue task" },
      },
    );
    expect(prompt.status).toBe(202);
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 412 }),
      expect.objectContaining({ cmd: "submit_initial_prompt", prompt: "Continue task" }),
      expect.objectContaining({ requireOk: true }),
    );

    const followUp = await requestJson(
      "POST",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${registration.body.host_id}/instances/wizard_team_app_101_1000/follow-up`,
      {
        token: accessToken,
        body: { message: "Please summarize blockers" },
      },
    );
    expect(followUp.status).toBe(202);
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 412 }),
      expect.objectContaining({ cmd: "submit_follow_up", prompt: "Please summarize blockers" }),
      expect.objectContaining({ requireOk: true }),
    );

    const trust = await requestJson(
      "POST",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${registration.body.host_id}/instances/wizard_team_app_101_1000/trust`,
      {
        token: accessToken,
        body: { approved: true },
      },
    );
    expect(trust.status).toBe(202);
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 412 }),
      expect.objectContaining({ cmd: "answer_trust_prompt", approved: true }),
      expect.objectContaining({ requireOk: true }),
    );

    const closed = await requestJson(
      "DELETE",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${registration.body.host_id}/instances/wizard_team_app_101_1000`,
      {
        token: accessToken,
      },
    );
    expect(closed.status).toBe(202);
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 412 }),
      expect.objectContaining({ cmd: "close_instance" }),
      expect.objectContaining({ requireOk: true }),
    );
    expect(closeInstance).toHaveBeenCalledWith(expect.objectContaining({ pid: 412 }));

    const refreshed = await requestJson("POST", `http://127.0.0.1:${relayPort}/v2/mobile/session/refresh`, {
      body: {
        refresh_token: originalRefreshToken,
      },
    });
    expect(refreshed.status).toBe(200);

    const reused = await requestJson("POST", `http://127.0.0.1:${relayPort}/v2/mobile/session/refresh`, {
      body: {
        refresh_token: originalRefreshToken,
      },
    });
    expect(reused.status).toBe(409);
    expect(reused.body.error).toBe("refresh_token_reused");

    const revokedAccess = await requestJson("GET", `http://127.0.0.1:${relayPort}/v2/mobile/hosts`, {
      token: refreshed.body.access_token,
    });
    expect(revokedAccess.status).toBe(401);
  });

  it("lists and explicitly revokes paired remote devices", async () => {
    const workspace = await createWorkspace();
    await writeBeacon(workspace.beaconPath, [buildBeaconEntry({ pid: 412 })]);

    const relayRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-test-"));
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
      await fs.rm(relayRoot, { recursive: true, force: true });
    });
    const relayPort = relay.server.address().port;

    const host = await startHostServer({
      allowNonWindows: true,
      config: {
        ...workspace.config,
        listenHost: "127.0.0.1",
        port: 0,
        remote: {
          enabled: true,
          relayUrl: `http://127.0.0.1:${relayPort}`,
          allowInsecureRelay: true,
          remoteStatePath: path.join(workspace.root, "remote_state.json"),
          bootstrapTtlMs: 10 * 60 * 1000,
        },
      },
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand: vi.fn(async () => ({ status: "ok" })),
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999, instance_id: "wizard_team_app_999_2000" })),
        closeInstance: vi.fn(async () => ({ status: "queued" })),
      },
    });
    cleanups.push(async () => {
      await host.close();
      await fs.rm(workspace.root, { recursive: true, force: true });
    });
    const hostBaseUrl = `http://127.0.0.1:${host.server.address().port}`;

    await waitFor(async () => {
      const status = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/status`);
      return status.body?.relay?.connected ? status.body : null;
    });

    const { registration } = await pairRemoteDevice({
      relayPort,
      hostBaseUrl,
      deviceName: "Revoker Phone",
    });

    const devices = await requestJson("GET", `http://127.0.0.1:${relayPort}/v2/mobile/devices`, {
      token: registration.body.access_token,
    });
    expect(devices.status).toBe(200);
    expect(devices.body.devices).toHaveLength(1);
    expect(devices.body.devices[0].device_name).toBe("Revoker Phone");

    const revoked = await requestJson(
      "DELETE",
      `http://127.0.0.1:${relayPort}/v2/mobile/devices/${devices.body.devices[0].device_id}`,
      {
        token: registration.body.access_token,
      },
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe("revoked");

    const revokedAccess = await requestJson("GET", `http://127.0.0.1:${relayPort}/v2/mobile/hosts`, {
      token: registration.body.access_token,
    });
    expect(revokedAccess.status).toBe(401);
  });

  it("reports host offline and closes remote update streams when the host disconnects", async () => {
    const workspace = await createWorkspace();
    await writeBeacon(workspace.beaconPath, [buildBeaconEntry({ pid: 812 })]);

    const relayRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-test-"));
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
      await fs.rm(relayRoot, { recursive: true, force: true });
    });
    const relayPort = relay.server.address().port;

    let hostClosed = false;
    const host = await startHostServer({
      allowNonWindows: true,
      config: {
        ...workspace.config,
        listenHost: "127.0.0.1",
        port: 0,
        remote: {
          enabled: true,
          relayUrl: `http://127.0.0.1:${relayPort}`,
          allowInsecureRelay: true,
          remoteStatePath: path.join(workspace.root, "remote_state.json"),
          bootstrapTtlMs: 10 * 60 * 1000,
        },
      },
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({
          status: "ok",
          snapshot: { phase: "running", task_state: { task: "Remote task", workers_done: 1 } },
          summary_text: "Remote summary",
          terminals_by_agent: { erasmus: "ready" },
          chat: [{ role: "assistant", text: "Remote summary" }],
        })),
        sendCommand: vi.fn(async () => ({
          status: "ok",
        })),
        tailEvents: vi.fn(async () => ({
          source: "events",
          events: [{ type: "message", message: "worker finished" }],
          next_cursor: 1,
        })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999, instance_id: "wizard_team_app_999_2000" })),
        closeInstance: vi.fn(async () => ({ status: "queued" })),
      },
    });
    cleanups.push(async () => {
      if (!hostClosed) {
        await host.close();
      }
      await fs.rm(workspace.root, { recursive: true, force: true });
    });
    const hostBaseUrl = `http://127.0.0.1:${host.server.address().port}`;

    await waitFor(async () => {
      const status = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/status`);
      return status.body?.relay?.connected ? status.body : null;
    });

    const { registration } = await pairRemoteDevice({
      relayPort,
      hostBaseUrl,
      deviceName: "Offline Watcher",
    });
    const accessToken = registration.body.access_token;
    const hostId = registration.body.host_id;

    const stream = await openEventStream(
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/instances/wizard_team_app_101_1000/updates`,
      accessToken,
    );
    const reader = stream.body.getReader();

    const firstChunk = await readSseUntil(reader, (text) => text.includes("event: instance_update"));
    expect(firstChunk).toContain("worker finished");

    await host.close();
    hostClosed = true;

    const disconnectChunk = await readSseUntil(reader, (text) => text.includes("event: disconnect_reason"));
    expect(disconnectChunk).toContain("host_offline");

    const hosts = await waitFor(async () => {
      const response = await requestJson("GET", `http://127.0.0.1:${relayPort}/v2/mobile/hosts`, {
        token: accessToken,
      });
      const state = response.body?.hosts?.[0]?.status;
      return state === "offline" ? response : null;
    });
    expect(hosts.status).toBe(200);
    expect(hosts.body.hosts[0].status).toBe("offline");

    const instances = await requestJson(
      "GET",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/instances`,
      { token: accessToken },
    );
    expect(instances.status).toBe(409);
    expect(instances.body.error).toBe("host_offline");

    await reader.cancel();
  });

  it("shuts down relay cleanly after a paired host disconnects", async () => {
    const workspace = await createWorkspace();
    await writeBeacon(workspace.beaconPath, [buildBeaconEntry({ pid: 812 })]);

    const relayRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-test-"));
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
    let relayClosed = false;
    cleanups.push(async () => {
      if (!relayClosed) {
        await relay.close();
      }
      await fs.rm(relayRoot, { recursive: true, force: true });
    });
    const relayPort = relay.server.address().port;

    const host = await startHostServer({
      allowNonWindows: true,
      config: {
        ...workspace.config,
        listenHost: "127.0.0.1",
        port: 0,
        remote: {
          enabled: true,
          relayUrl: `http://127.0.0.1:${relayPort}`,
          allowInsecureRelay: true,
          remoteStatePath: path.join(workspace.root, "remote_state.json"),
          bootstrapTtlMs: 10 * 60 * 1000,
        },
      },
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand: vi.fn(async () => ({ status: "ok" })),
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999, instance_id: "wizard_team_app_999_2000" })),
        closeInstance: vi.fn(async () => ({ status: "queued" })),
      },
    });
    let hostClosed = false;
    cleanups.push(async () => {
      if (!hostClosed) {
        await host.close();
      }
      await fs.rm(workspace.root, { recursive: true, force: true });
    });
    const hostBaseUrl = `http://127.0.0.1:${host.server.address().port}`;

    await waitFor(async () => {
      const status = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/status`);
      return status.body?.relay?.connected ? status.body : null;
    });

    await pairRemoteDevice({
      relayPort,
      hostBaseUrl,
      deviceName: "Shutdown Checker",
    });

    await host.close();
    hostClosed = true;

    await relay.close();
    relayClosed = true;
  });

  it("forwards remote CLI list/launch/prompt/stream/close commands", async () => {
    const workspace = await createWorkspace();
    const relayRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-test-"));
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
      },
    });
    cleanups.push(async () => {
      await relay.close();
      await fs.rm(relayRoot, { recursive: true, force: true });
    });
    const relayPort = relay.server.address().port;

    const cliChild = fakeCliChild();
    const cliInstancesManager = new CliInstancesManager({
      spawnImpl: vi.fn(() => cliChild),
      ptySpawnImpl: null,
      now: (() => {
        let tick = 10_000;
        return () => ++tick;
      })(),
      statePath: path.join(workspace.root, "cli_instances.json"),
    });
    const host = await startHostServer({
      allowNonWindows: true,
      config: {
        ...workspace.config,
        listenHost: "127.0.0.1",
        port: 0,
        remote: {
          enabled: true,
          relayUrl: `http://127.0.0.1:${relayPort}`,
          allowInsecureRelay: true,
          remoteStatePath: path.join(workspace.root, "remote_state.json"),
          bootstrapTtlMs: 10 * 60 * 1000,
        },
      },
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand: vi.fn(async () => ({ status: "ok" })),
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999 })),
        closeInstance: vi.fn(async () => ({ status: "queued" })),
      },
      cliInstancesManager,
    });
    cleanups.push(async () => {
      await host.close();
      await fs.rm(workspace.root, { recursive: true, force: true });
    });
    const hostBaseUrl = `http://127.0.0.1:${host.server.address().port}`;

    await waitFor(async () => {
      const status = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/status`);
      return status.body?.relay?.connected ? status.body : null;
    });

    const { registration } = await pairRemoteDevice({
      relayPort,
      hostBaseUrl,
      deviceName: "CLI Remote Phone",
    });
    const accessToken = registration.body.access_token;
    const hostId = registration.body.host_id;

    const presets = await requestJson(
      "GET",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/cli-instances/presets`,
      { token: accessToken },
    );
    expect(presets.status).toBe(200);
    expect(presets.body.presets.map((entry) => entry.preset).sort()).toEqual(["claude", "codex", "gemini"]);

    const launch = await requestJson(
      "POST",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/cli-instances`,
      {
        token: accessToken,
        body: {
          preset: "codex",
          title: "Remote CLI",
          initial_prompt: "inspect the repo",
        },
      },
    );
    expect(launch.status).toBe(201);
    expect(launch.body.preset).toBe("codex");
    expect(launch.body.status).toBe("running");

    const listed = await requestJson(
      "GET",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/cli-instances`,
      { token: accessToken },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.instances).toHaveLength(1);

    const instanceId = launch.body.instance_id;
    const stream = await openEventStream(
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/cli-instances/${instanceId}/updates`,
      accessToken,
    );
    const reader = stream.body.getReader();
    cliChild.stdout.emit("data", Buffer.from("hello from cli"));
    const streamed = await readSseUntil(reader, (text) => text.includes("hello from cli"));
    expect(streamed).toContain("hello from cli");

    const prompt = await requestJson(
      "POST",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/cli-instances/${instanceId}/prompt`,
      {
        token: accessToken,
        body: { prompt: "continue" },
      },
    );
    expect(prompt.status).toBe(202);
    expect(cliChild.stdin.write).toHaveBeenLastCalledWith("continue\n");

    const close = await requestJson(
      "DELETE",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/cli-instances/${instanceId}`,
      { token: accessToken },
    );
    expect(close.status).toBe(202);
    expect(cliChild.kill).toHaveBeenCalledWith("SIGTERM");

    await reader.cancel();
  });

  it("forwards remote browser page list/open/search/select commands", async () => {
    const workspace = await createWorkspace();
    const relayRoot = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-relay-test-"));
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
      },
    });
    cleanups.push(async () => {
      await relay.close();
      await fs.rm(relayRoot, { recursive: true, force: true });
    });
    const relayPort = relay.server.address().port;

    const browserControlService = {
      listPages: vi.fn(async () => [
        { page_id: "page_1", url: "https://example.com", title: "Example", selected: true },
      ]),
      openUrl: vi.fn(async (url, options) => ({ status: "ok", page_id: "page_2", url, ...options })),
      search: vi.fn(async (query, engine) => ({ status: "ok", page_id: "page_3", query, engine })),
      selectPage: vi.fn(async (pageId) => ({ status: "selected", page_id: pageId })),
    };

    const host = await startHostServer({
      allowNonWindows: true,
      config: {
        ...workspace.config,
        listenHost: "127.0.0.1",
        port: 0,
        remote: {
          enabled: true,
          relayUrl: `http://127.0.0.1:${relayPort}`,
          allowInsecureRelay: true,
          remoteStatePath: path.join(workspace.root, "remote_state.json"),
          bootstrapTtlMs: 10 * 60 * 1000,
        },
      },
      processProbe: vi.fn(() => true),
      ipcClient: {
        inspect: vi.fn(async () => ({ status: "ok" })),
        sendCommand: vi.fn(async () => ({ status: "ok" })),
        tailEvents: vi.fn(async () => ({ source: "events", events: [], next_cursor: 0 })),
      },
      lifecycleManager: {
        launchInstance: vi.fn(async () => buildBeaconEntry({ pid: 999 })),
        closeInstance: vi.fn(async () => ({ status: "queued" })),
      },
      browserControlService,
    });
    cleanups.push(async () => {
      await host.close();
      await fs.rm(workspace.root, { recursive: true, force: true });
    });
    const hostBaseUrl = `http://127.0.0.1:${host.server.address().port}`;

    await waitFor(async () => {
      const status = await requestJson("GET", `${hostBaseUrl}/admin/v2/remote/status`);
      return status.body?.relay?.connected ? status.body : null;
    });

    const { registration } = await pairRemoteDevice({
      relayPort,
      hostBaseUrl,
      deviceName: "Browser Remote Phone",
    });
    const accessToken = registration.body.access_token;
    const hostId = registration.body.host_id;

    const pages = await requestJson(
      "GET",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/browser/pages`,
      { token: accessToken },
    );
    expect(pages.status).toBe(200);
    expect(pages.body.pages[0].page_id).toBe("page_1");

    const open = await requestJson(
      "POST",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/browser/actions`,
      {
        token: accessToken,
        body: { kind: "browser_open", url: "https://youtube.com" },
      },
    );
    expect(open.status).toBe(202);
    expect(browserControlService.openUrl).toHaveBeenCalledWith("https://youtube.com", { newPage: true });

    const search = await requestJson(
      "POST",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/browser/actions`,
      {
        token: accessToken,
        body: { kind: "browser_search", query: "lofi mix", engine: "youtube" },
      },
    );
    expect(search.status).toBe(202);
    expect(browserControlService.search).toHaveBeenCalledWith("lofi mix", "youtube");

    const select = await requestJson(
      "POST",
      `http://127.0.0.1:${relayPort}/v2/mobile/hosts/${hostId}/browser/actions`,
      {
        token: accessToken,
        body: { kind: "browser_select_page", page_id: "page_1" },
      },
    );
    expect(select.status).toBe(202);
    expect(browserControlService.selectPage).toHaveBeenCalledWith("page_1");
  });
});
