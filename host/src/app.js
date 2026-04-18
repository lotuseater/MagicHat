import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import express from "express";
import { readHostConfig } from "./config.js";
import { PairingManager } from "./auth/pairingManager.js";
import { buildAuthMiddleware } from "./auth/authMiddleware.js";
import { enforceLanOnly } from "./network/lanGuard.js";
import { BeaconStore } from "./teamapp/beaconStore.js";
import { TeamAppIpcClient } from "./teamapp/ipcClient.js";
import { ProcessController } from "./lifecycle/processController.js";
import { LifecycleManager } from "./lifecycle/lifecycleManager.js";
import { HostControlService } from "./operations/hostControlService.js";
import { CliInstancesManager } from "./operations/cliInstancesManager.js";
import { BrowserControlService } from "./operations/browserControlService.js";
import { QuickActionsService } from "./operations/quickActionsService.js";
import { RemoteAccessState } from "./remote/remoteAccessState.js";
import { RelayClient } from "./remote/relayClient.js";

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function toSseEvent(eventName, id, payload) {
  return `id: ${id}\nevent: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return fallback;
}

function requireLocalhost(req, res, next) {
  const remoteAddress = req.socket?.remoteAddress || "";
  const allowed = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  if (!allowed.has(remoteAddress)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

function errorCodeFor(error) {
  return error?.code || error?.message || "internal_error";
}

function statusForError(error) {
  switch (errorCodeFor(error)) {
    case "instance_not_found":
      return 404;
    case "restore_ref_not_allowed":
      return 400;
    case "host_offline":
      return 409;
    case "quick_action_invalid_url":
    case "quick_action_missing_query":
    case "quick_action_missing_command":
    case "quick_action_unsupported":
    case "browser_invalid_selector":
      return 400;
    case "browser_control_unavailable":
      return 409;
    case "browser_page_not_found":
    case "browser_click_target_not_found":
    case "browser_fill_target_not_found":
      return 404;
    default:
      return 500;
  }
}

export function createMagicHatRuntime(options = {}) {
  const config = options.config || readHostConfig();

  const pairingManager =
    options.pairingManager ||
    new PairingManager({
      statePath: config.statePath,
      pairingCodeTtlMs: config.pairingCodeTtlMs,
      tokenTtlMs: config.tokenTtlMs,
    });

  const activePairing = pairingManager.getActivePairingCode();

  const beaconStore =
    options.beaconStore ||
    new BeaconStore({
      beaconPath: config.beaconPath,
      processProbe: options.processProbe,
    });

  const ipcClient = options.ipcClient || new TeamAppIpcClient();
  const processController = options.processController || new ProcessController();

  const lifecycleManager =
    options.lifecycleManager ||
    new LifecycleManager({
      beaconStore,
      ipcClient,
      processController,
      launchConfig: config.launch,
    });

  const remoteAccessState =
    options.remoteAccessState ||
    new RemoteAccessState({
      statePath: config.remote.remoteStatePath,
    });

  const hostInfo = {
    host_id: pairingManager.hostId(),
    host_name: os.hostname(),
    lan_address: config.listenHost,
    api_version: "1.0.0",
    scope: "lan_only_v1",
  };

  const cliInstancesManager =
    options.cliInstancesManager ||
    new CliInstancesManager({
      statePath: path.join(path.dirname(config.statePath), "magichat_cli_instances.json"),
      processProbe: options.processProbe,
    });

  const browserControlService =
    options.browserControlService ||
    new BrowserControlService();

  const quickActionsService =
    options.quickActionsService ||
    new QuickActionsService({ browserControlService });

  const hostControlService =
    options.hostControlService ||
    new HostControlService({
      beaconStore,
      ipcClient,
      lifecycleManager,
      remoteAccessState,
      quickActionsService,
    });

  const relaySubscriptions = new Map();

  let relayClient = options.relayClient || null;
  if (!relayClient && config.remote.enabled && config.remote.relayUrl) {
    relayClient = new RelayClient({
      relayUrl: config.remote.relayUrl,
      allowInsecureRelay: config.remote.allowInsecureRelay,
      remoteAccessState,
      hostId: hostInfo.host_id,
      hostName: hostInfo.host_name,
      async commandHandler(command, context) {
        switch (command.kind) {
          case "list_instances":
            return { instances: await hostControlService.listRemoteInstances() };
          case "get_instance_detail":
            return await hostControlService.getRemoteInstanceDetail(command.params.instance_id);
          case "launch_instance":
            return await hostControlService.launchInstance({
              title: command.params.title,
              restoreRef: command.params.restore_ref,
              teamMode: command.params.team_mode,
              launcherPreset: command.params.launcher_preset,
              fenrusLauncher: command.params.fenrus_launcher,
              remoteSafe: true,
            });
          case "close_instance":
            return await hostControlService.closeInstance(command.params.instance_id);
          case "send_prompt":
            return await hostControlService.sendPrompt(command.params.instance_id, command.params.prompt);
          case "send_follow_up":
            return await hostControlService.sendFollowUp(
              command.params.instance_id,
              command.params.message,
            );
          case "answer_trust_prompt":
            return await hostControlService.answerTrustPrompt(
              command.params.instance_id,
              command.params.approved,
            );
          case "restore_instance":
            return await hostControlService.restoreExistingInstance(command.params.instance_id, {
              restoreRef: command.params.restore_ref,
              remoteSafe: true,
            });
          case "list_known_restore_refs":
            return { restore_refs: await hostControlService.listKnownRestoreRefs() };
          case "subscribe_instance_updates": {
            const subscriptionId = command.params.subscription_id;
            const instanceId = command.params.instance_id;
            if (!subscriptionId || !instanceId) {
              throw new Error("bad_request");
            }
            if (relaySubscriptions.has(subscriptionId)) {
              return { status: "already_subscribed" };
            }
            const state = { closed: false };
            relaySubscriptions.set(subscriptionId, state);
            hostControlService
              .streamInstanceUpdates(instanceId, {
                cursor: command.params.cursor || 0,
                isClosed: () => state.closed,
                onChunk: async (_source, event) => {
                  if (state.closed) {
                    return;
                  }
                  context.sendUpdate({
                    subscription_id: subscriptionId,
                    instance_id: instanceId,
                    event,
                  });
                },
              })
              .finally(() => {
                relaySubscriptions.delete(subscriptionId);
              });
            return { status: "subscribed", subscription_id: subscriptionId };
          }
          case "unsubscribe_instance_updates": {
            const subscriptionId = command.params.subscription_id;
            const active = relaySubscriptions.get(subscriptionId);
            if (active) {
              active.closed = true;
              relaySubscriptions.delete(subscriptionId);
            }
            return { status: "unsubscribed", subscription_id: subscriptionId };
          }
          case "list_cli_presets":
            return { presets: cliInstancesManager.listPresets() };
          case "list_cli_instances":
            return { instances: cliInstancesManager.listInstances() };
          case "launch_cli_instance":
            return cliInstancesManager.launchInstance({
              preset: command.params.preset,
              title: command.params.title,
              initialPrompt: command.params.initial_prompt,
              extraArgs: Array.isArray(command.params.extra_args) ? command.params.extra_args : undefined,
            });
          case "get_cli_instance":
            return cliInstancesManager.getInstance(command.params.instance_id);
          case "close_cli_instance":
            return cliInstancesManager.closeInstance(command.params.instance_id, {
              force: !!command.params.force,
            });
          case "send_cli_prompt":
            return cliInstancesManager.sendPrompt(command.params.instance_id, command.params.prompt);
          case "list_quick_actions":
            return { actions: quickActionsService.listActions() };
          case "execute_quick_action":
            return quickActionsService.execute(command.params);
          case "list_browser_pages":
            return { pages: await browserControlService.listPages() };
          case "execute_browser_action":
            return await quickActionsService.execute(command.params);
          case "subscribe_cli_updates": {
            const subscriptionId = command.params.subscription_id;
            const instanceId = command.params.instance_id;
            if (!subscriptionId || !instanceId) {
              throw new Error("bad_request");
            }
            if (relaySubscriptions.has(subscriptionId)) {
              return { status: "already_subscribed" };
            }
            const state = { closed: false, stop: null };
            relaySubscriptions.set(subscriptionId, state);
            try {
              state.stop = cliInstancesManager.observeInstance(instanceId, {
                sinceTs: 0,
                onEvent: (event) => {
                  if (state.closed) return;
                  context.sendUpdate({
                    subscription_id: subscriptionId,
                    instance_id: instanceId,
                    event,
                  });
                },
              });
            } catch (err) {
              relaySubscriptions.delete(subscriptionId);
              throw err;
            }
            return { status: "subscribed", subscription_id: subscriptionId };
          }
          case "unsubscribe_cli_updates": {
            const subscriptionId = command.params.subscription_id;
            const active = relaySubscriptions.get(subscriptionId);
            if (active) {
              active.closed = true;
              try { active.stop?.(); } catch { /* ignore */ }
              relaySubscriptions.delete(subscriptionId);
            }
            return { status: "unsubscribed", subscription_id: subscriptionId };
          }
          default: {
            const error = new Error("unsupported_command");
            error.code = "unsupported_command";
            throw error;
          }
        }
      },
    });
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", asyncRoute(async (_req, res) => {
    const response = {
      status: "ok",
      service: "magichat-host",
      ts: Date.now(),
      beacon_path: config.beaconPath,
    };
    try {
      const instances = await beaconStore.listInstances();
      const now = Date.now();
      const withHeartbeat = instances
        .map((inst) => {
          const hbMs = Number(inst.heartbeat_ts ?? 0);
          const ageMs = Number.isFinite(hbMs) && hbMs > 0 ? now - hbMs : null;
          return { id: inst.id, pid: inst.pid, heartbeat_ts: inst.heartbeat_ts, age_ms: ageMs };
        });
      const fresh = withHeartbeat.filter((i) => i.age_ms !== null && i.age_ms <= 30000);
      response.instances_total = withHeartbeat.length;
      response.instances_fresh = fresh.length;
      response.team_app_reachable = withHeartbeat.length > 0;
      response.team_app_fresh = fresh.length > 0;
      response.instances = withHeartbeat;
      if (withHeartbeat.length === 0) {
        response.team_app_reason = "no_beacon_entries";
      } else if (fresh.length === 0) {
        response.team_app_reason = "beacon_stale_over_30s";
      }
    } catch (err) {
      response.team_app_reachable = false;
      response.team_app_reason = `beacon_read_error:${err?.message || "unknown"}`;
    }
    res.json(response);
  }));

  app.use("/v1", enforceLanOnly(options.lanGuardOptions));
  app.use("/v1", buildAuthMiddleware(pairingManager));

  app.post(
    "/v1/pairing/session",
    asyncRoute(async (req, res) => {
      const pairingCode = `${req.body?.pairing_code || ""}`.trim();
      const deviceName = `${req.body?.device_name || ""}`.trim();
      const deviceId = `${req.body?.device_id || ""}`.trim();

      if (!pairingCode || !deviceName) {
        res.status(400).json({ error: "bad_request" });
        return;
      }

      const exchange = pairingManager.exchangePairingCode({
        pairingCode,
        deviceName,
        deviceId,
      });

      if (exchange.status === "invalid_code") {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      if (exchange.status === "expired_or_used") {
        res.status(409).json({ error: "pairing_code_expired_or_used" });
        return;
      }

      res.status(201).json({
        session_token: exchange.record.token,
        expires_at: new Date(exchange.record.expires_at_ms).toISOString(),
        host_id: hostInfo.host_id,
        host_name: hostInfo.host_name,
      });
    }),
  );

  app.get(
    "/v1/host",
    asyncRoute(async (_req, res) => {
      res.json(hostInfo);
    }),
  );

  app.get(
    "/v1/instances",
    asyncRoute(async (_req, res) => {
      res.json({ instances: await hostControlService.listInstances() });
    }),
  );

  app.get(
    "/v1/restore-refs",
    asyncRoute(async (_req, res) => {
      res.json({ restore_refs: await hostControlService.listKnownRestoreRefs() });
    }),
  );

  app.post(
    "/v1/instances",
    asyncRoute(async (req, res) => {
      const startupTimeoutMs = Number.parseInt(req.body?.startup_timeout_ms, 10);
      const launched = await hostControlService.launchInstance({
        title: `${req.body?.title || ""}`.trim() || undefined,
        restoreStatePath: `${req.body?.restore_state_path || ""}`.trim() || undefined,
        restoreRef: `${req.body?.restore_ref || ""}`.trim() || undefined,
        startupTimeoutMs: Number.isFinite(startupTimeoutMs) ? startupTimeoutMs : undefined,
        teamMode: `${req.body?.team_mode || ""}`.trim() || undefined,
        launcherPreset: `${req.body?.launcher_preset || ""}`.trim() || undefined,
        fenrusLauncher: `${req.body?.fenrus_launcher || ""}`.trim() || undefined,
      });
      res.status(201).json(launched);
    }),
  );

  app.get(
    "/v1/instances/:pid",
    asyncRoute(async (req, res) => {
      res.json(await hostControlService.getInstanceDetail(req.params.pid));
    }),
  );

  app.delete(
    "/v1/instances/:pid",
    asyncRoute(async (req, res) => {
      await hostControlService.closeInstance(req.params.pid);
      res.status(202).json({ status: "queued" });
    }),
  );

  app.post(
    "/v1/instances/:pid/prompt",
    asyncRoute(async (req, res) => {
      const prompt = `${req.body?.prompt || ""}`.trim();
      if (!prompt) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      await hostControlService.sendPrompt(req.params.pid, prompt);
      res.status(202).json({ status: "queued" });
    }),
  );

  app.post(
    "/v1/instances/:pid/follow-up",
    asyncRoute(async (req, res) => {
      const message = `${req.body?.message || ""}`.trim();
      if (!message) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      await hostControlService.sendFollowUp(req.params.pid, message);
      res.status(202).json({ status: "queued" });
    }),
  );

  app.post(
    "/v1/instances/:pid/trust",
    asyncRoute(async (req, res) => {
      if (typeof req.body?.approved !== "boolean") {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      await hostControlService.answerTrustPrompt(req.params.pid, req.body.approved);
      res.status(202).json({ status: "queued" });
    }),
  );

  app.post(
    "/v1/instances/:pid/restore",
    asyncRoute(async (req, res) => {
      const restoreStatePath = `${req.body?.restore_state_path || ""}`.trim();
      const restoreRef = `${req.body?.restore_ref || ""}`.trim();
      if (!restoreStatePath && !restoreRef) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      await hostControlService.restoreExistingInstance(req.params.pid, {
        restoreStatePath: restoreStatePath || undefined,
        restoreRef: restoreRef || undefined,
        remoteSafe: !!restoreRef,
      });
      res.status(202).json({ status: "queued" });
    }),
  );

  app.get(
    "/v1/cli-instances/presets",
    asyncRoute(async (_req, res) => {
      res.json({ presets: cliInstancesManager.listPresets() });
    }),
  );

  app.get(
    "/v1/cli-instances",
    asyncRoute(async (_req, res) => {
      res.json({ instances: cliInstancesManager.listInstances() });
    }),
  );

  app.post(
    "/v1/cli-instances",
    asyncRoute(async (req, res) => {
      const preset = `${req.body?.preset || ""}`.trim();
      if (!preset) {
        res.status(400).json({ error: "bad_request", detail: "preset is required" });
        return;
      }
      try {
        const launched = cliInstancesManager.launchInstance({
          preset,
          title: req.body?.title,
          initialPrompt: req.body?.initial_prompt,
          extraArgs: Array.isArray(req.body?.extra_args) ? req.body.extra_args : undefined,
        });
        res.status(201).json(launched);
      } catch (err) {
        if (err?.code === "unknown_cli_preset") {
          res.status(400).json({ error: err.code });
          return;
        }
        throw err;
      }
    }),
  );

  app.get(
    "/v1/cli-instances/:id",
    asyncRoute(async (req, res) => {
      try {
        res.json(cliInstancesManager.getInstance(req.params.id));
      } catch (err) {
        if (err?.code === "cli_instance_not_found") {
          res.status(404).json({ error: err.code });
          return;
        }
        throw err;
      }
    }),
  );

  app.delete(
    "/v1/cli-instances/:id",
    asyncRoute(async (req, res) => {
      const force = parseBoolean(req.query.force, false);
      try {
        const result = cliInstancesManager.closeInstance(req.params.id, { force });
        res.status(202).json(result);
      } catch (err) {
        if (err?.code === "cli_instance_not_found") {
          res.status(404).json({ error: err.code });
          return;
        }
        throw err;
      }
    }),
  );

  app.post(
    "/v1/cli-instances/:id/prompt",
    asyncRoute(async (req, res) => {
      const prompt = `${req.body?.prompt || ""}`.trim();
      if (!prompt) {
        res.status(400).json({ error: "bad_request" });
        return;
      }
      try {
        const result = cliInstancesManager.sendPrompt(req.params.id, prompt);
        res.status(202).json(result);
      } catch (err) {
        if (err?.code === "cli_instance_not_found") {
          res.status(404).json({ error: err.code });
          return;
        }
        if (err?.code === "cli_instance_not_running" || err?.code === "stdin_unavailable") {
          res.status(409).json({ error: err.code });
          return;
        }
        throw err;
      }
    }),
  );

  app.get(
    "/v1/cli-instances/:id/updates",
    asyncRoute(async (req, res) => {
      try {
        cliInstancesManager.getInstance(req.params.id);
      } catch (err) {
        if (err?.code === "cli_instance_not_found") {
          res.status(404).json({ error: err.code });
          return;
        }
        throw err;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const rawSince = req.query.since_ts ?? req.get("last-event-id") ?? 0;
      let sinceTs = Number.parseInt(rawSince, 10);
      if (!Number.isFinite(sinceTs) || sinceTs < 0) {
        sinceTs = 0;
      }

      let counter = sinceTs;
      const stop = cliInstancesManager.observeInstance(req.params.id, {
        sinceTs,
        onEvent: (event) => {
          counter += 1;
          res.write(toSseEvent(event.source, counter, event));
        },
      });

      const heartbeat = setInterval(() => {
        res.write(toSseEvent("heartbeat", counter, { ts: Date.now() }));
      }, 15_000);

      req.on("close", () => {
        clearInterval(heartbeat);
        stop();
        res.end();
      });
    }),
  );

  app.get(
    "/v1/quick-actions",
    asyncRoute(async (_req, res) => {
      res.json({ actions: quickActionsService.listActions() });
    }),
  );

  app.post(
    "/v1/quick-actions",
    asyncRoute(async (req, res) => {
      const result = await quickActionsService.execute(req.body || {});
      res.status(202).json(result);
    }),
  );

  app.get(
    "/v1/browser/pages",
    asyncRoute(async (_req, res) => {
      res.json({ pages: await browserControlService.listPages() });
    }),
  );

  app.post(
    "/v1/browser/actions",
    asyncRoute(async (req, res) => {
      const result = await quickActionsService.execute(req.body || {});
      res.status(202).json(result);
    }),
  );

  app.get(
    "/v1/instances/:pid/poll",
    asyncRoute(async (req, res) => {
      const instance = await hostControlService.requireInstance(req.params.pid);
      const inspect = await ipcClient.inspect(instance, {
        include_chat: parseBoolean(req.query.include_chat, true),
        include_summary: parseBoolean(req.query.include_summary, true),
        include_terminals: parseBoolean(req.query.include_terminals, true),
      });
      res.json({
        ...hostControlService.toLanInstance(instance),
        status: inspect?.status || "error",
        snapshot: inspect?.snapshot || {},
        chat: Array.isArray(inspect?.chat) ? inspect.chat : [],
        summary_text: typeof inspect?.summary_text === "string" ? inspect.summary_text : "",
        terminals_by_agent:
          inspect?.terminals_by_agent && typeof inspect?.terminals_by_agent === "object"
            ? inspect.terminals_by_agent
            : {},
        run_log_path: inspect?.run_log_path || "",
      });
    }),
  );

  app.get(
    "/v1/instances/:pid/updates",
    asyncRoute(async (req, res) => {
      await hostControlService.requireInstance(req.params.pid);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const rawCursor = req.query.cursor ?? req.get("last-event-id") ?? 0;
      let cursor = Number.parseInt(rawCursor, 10);
      if (!Number.isFinite(cursor) || cursor < 0) {
        cursor = 0;
      }

      let closed = false;
      req.on("close", () => {
        closed = true;
      });

      while (!closed) {
        const current = await beaconStore.getInstanceById(req.params.pid);
        if (!current) {
          res.write(toSseEvent("instance_missing", cursor, { pid: req.params.pid }));
          break;
        }

        const update = await ipcClient.tailEvents(current, cursor);
        if (update.events.length > 0) {
          let rollingId = cursor;
          for (const event of update.events) {
            rollingId += 1;
            res.write(toSseEvent(update.source, rollingId, event));
          }
        } else {
          res.write(toSseEvent("heartbeat", cursor, { ts: Date.now() }));
        }

        cursor = update.next_cursor;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      res.end();
    }),
  );

  app.use("/admin/v2", requireLocalhost);

  app.get(
    "/admin/v2/remote/status",
    asyncRoute(async (_req, res) => {
      const identity = remoteAccessState.hostIdentity(hostInfo.host_id, hostInfo.host_name);
      res.json({
        enabled: config.remote.enabled,
        relay_url: config.remote.relayUrl,
        host_id: hostInfo.host_id,
        host_name: hostInfo.host_name,
        host_fingerprint: identity.fingerprint,
        relay: relayClient?.statusSnapshot() || {
          connected: false,
          relay_url: config.remote.relayUrl,
          host_id: hostInfo.host_id,
        },
        pending_approvals: remoteAccessState.listPendingApprovals(),
      });
    }),
  );

  app.post(
    "/admin/v2/remote/bootstrap",
    asyncRoute(async (_req, res) => {
      if (!config.remote.enabled || !config.remote.relayUrl) {
        res.status(400).json({ error: "remote_disabled" });
        return;
      }
      const bootstrap = remoteAccessState.createPairingBootstrap({
        relayUrl: config.remote.relayUrl,
        hostId: hostInfo.host_id,
        hostName: hostInfo.host_name,
        ttlMs: config.remote.bootstrapTtlMs,
      });
      const qrSvg = await QRCode.toString(bootstrap.pair_uri, { type: "svg", margin: 1 });
      res.json({
        ...bootstrap,
        qr_svg: qrSvg,
      });
    }),
  );

  app.get(
    "/admin/v2/remote/pending-devices",
    asyncRoute(async (_req, res) => {
      res.json({ pending_approvals: remoteAccessState.listPendingApprovals() });
    }),
  );

  app.post(
    "/admin/v2/remote/pending-devices/:claimId/approve",
    asyncRoute(async (req, res) => {
      if (!relayClient) {
        res.status(409).json({ error: "host_offline" });
        return;
      }
      await relayClient.approveClaim(req.params.claimId);
      res.json({ status: "approved" });
    }),
  );

  app.post(
    "/admin/v2/remote/pending-devices/:claimId/reject",
    asyncRoute(async (req, res) => {
      if (!relayClient) {
        res.status(409).json({ error: "host_offline" });
        return;
      }
      await relayClient.rejectClaim(req.params.claimId);
      res.json({ status: "rejected" });
    }),
  );

  app.get(
    "/admin/v2/remote/devices",
    asyncRoute(async (_req, res) => {
      if (!relayClient) {
        res.status(409).json({ error: "host_offline" });
        return;
      }
      const devices = await relayClient.listDevices();
      res.json({ devices });
    }),
  );

  app.delete(
    "/admin/v2/remote/devices/:deviceId",
    asyncRoute(async (req, res) => {
      if (!relayClient) {
        res.status(409).json({ error: "host_offline" });
        return;
      }
      await relayClient.revokeDevice(req.params.deviceId);
      res.json({ status: "revoked" });
    }),
  );

  app.get(
    "/admin/v2/remote/restore-refs",
    asyncRoute(async (_req, res) => {
      res.json({ restore_refs: await hostControlService.listKnownRestoreRefs() });
    }),
  );

  app.use((error, _req, res, _next) => {
    if (res.headersSent) {
      return;
    }
    res.status(statusForError(error)).json({
      error: errorCodeFor(error),
      detail: error?.message || "unknown",
    });
  });

  return {
    app,
    config,
    pairingManager,
    beaconStore,
    ipcClient,
    lifecycleManager,
    hostControlService,
    browserControlService,
    quickActionsService,
    remoteAccessState,
    relayClient,
    pairing_code: activePairing.code,
    pairing_expires_at_ms: activePairing.expires_at_ms,
  };
}

export function createMagicHatApp(options = {}) {
  return createMagicHatRuntime(options).app;
}
