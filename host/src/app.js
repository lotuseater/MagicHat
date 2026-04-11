import os from "node:os";
import express from "express";
import { readHostConfig } from "./config.js";
import { PairingManager } from "./auth/pairingManager.js";
import { buildAuthMiddleware } from "./auth/authMiddleware.js";
import { enforceLanOnly } from "./network/lanGuard.js";
import { BeaconStore } from "./teamapp/beaconStore.js";
import { TeamAppIpcClient } from "./teamapp/ipcClient.js";
import { ProcessController } from "./lifecycle/processController.js";
import { LifecycleManager } from "./lifecycle/lifecycleManager.js";

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

function buildInstanceDetail(publicInstance, inspect) {
  return {
    ...publicInstance,
    status: inspect?.status || "error",
    snapshot: inspect?.snapshot || {},
    chat: Array.isArray(inspect?.chat) ? inspect.chat : [],
    summary_text: typeof inspect?.summary_text === "string" ? inspect.summary_text : "",
    terminals_by_agent:
      inspect?.terminals_by_agent && typeof inspect.terminals_by_agent === "object"
        ? inspect.terminals_by_agent
        : {},
    run_log_path: inspect?.run_log_path || "",
  };
}

function buildTargetedInstanceCommand(instance, command) {
  return {
    ...command,
    instance_id: instance.instance_id || undefined,
    pid: instance.pid,
  };
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

  const hostInfo = {
    host_id: pairingManager.hostId(),
    host_name: os.hostname(),
    lan_address: config.listenHost,
    api_version: "1.0.0",
    scope: "lan_only_v1",
  };

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", service: "magichat-host", ts: Date.now() });
  });

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

  async function getInstanceOr404(req, res) {
    const instance = await beaconStore.getInstanceById(req.params.pid);
    if (!instance) {
      res.status(404).json({ error: "instance_not_found" });
      return null;
    }
    return instance;
  }

  app.get(
    "/v1/instances",
    asyncRoute(async (_req, res) => {
      const instances = await beaconStore.listInstances();
      res.json({ instances });
    }),
  );

  app.post(
    "/v1/instances",
    asyncRoute(async (req, res) => {
      const startupTimeoutMs = Number.parseInt(req.body?.startup_timeout_ms, 10);
      const launched = await lifecycleManager.launchInstance({
        startupTimeoutMs: Number.isFinite(startupTimeoutMs) ? startupTimeoutMs : undefined,
      });

      if (req.body?.restore_state_path) {
        await ipcClient.sendCommand(launched, {
          cmd: "restore_session",
          path: `${req.body.restore_state_path}`,
        });
      }

      res.status(201).json(beaconStore.toPublicInstance(launched));
    }),
  );

  app.get(
    "/v1/instances/:pid",
    asyncRoute(async (req, res) => {
      const instance = await getInstanceOr404(req, res);
      if (!instance) {
        return;
      }

      const inspect = await ipcClient.inspect(instance, {
        include_chat: true,
        include_summary: true,
        include_terminals: true,
      });

      res.json(buildInstanceDetail(beaconStore.toPublicInstance(instance), inspect));
    }),
  );

  app.delete(
    "/v1/instances/:pid",
    asyncRoute(async (req, res) => {
      const instance = await getInstanceOr404(req, res);
      if (!instance) {
        return;
      }

      await ipcClient.sendCommand(
        instance,
        buildTargetedInstanceCommand(instance, {
          cmd: "close_instance",
        }),
      );
      await lifecycleManager.closeInstance(instance);

      res.status(202).json({ status: "queued" });
    }),
  );

  app.post(
    "/v1/instances/:pid/prompt",
    asyncRoute(async (req, res) => {
      const instance = await getInstanceOr404(req, res);
      if (!instance) {
        return;
      }

      const prompt = `${req.body?.prompt || ""}`.trim();
      if (!prompt) {
        res.status(400).json({ error: "bad_request" });
        return;
      }

      await ipcClient.sendCommand(
        instance,
        buildTargetedInstanceCommand(instance, {
          cmd: "submit_initial_prompt",
          prompt,
        }),
      );

      res.status(202).json({ status: "queued" });
    }),
  );

  app.post(
    "/v1/instances/:pid/follow-up",
    asyncRoute(async (req, res) => {
      const instance = await getInstanceOr404(req, res);
      if (!instance) {
        return;
      }

      const message = `${req.body?.message || ""}`.trim();
      if (!message) {
        res.status(400).json({ error: "bad_request" });
        return;
      }

      await ipcClient.sendCommand(
        instance,
        buildTargetedInstanceCommand(instance, {
          cmd: "submit_follow_up",
          prompt: message,
        }),
      );

      res.status(202).json({ status: "queued" });
    }),
  );

  app.post(
    "/v1/instances/:pid/restore",
    asyncRoute(async (req, res) => {
      const instance = await getInstanceOr404(req, res);
      if (!instance) {
        return;
      }

      const restoreStatePath = `${req.body?.restore_state_path || ""}`.trim();
      if (!restoreStatePath) {
        res.status(400).json({ error: "bad_request" });
        return;
      }

      await ipcClient.sendCommand(instance, {
        cmd: "restore_session",
        path: restoreStatePath,
      });

      res.status(202).json({ status: "queued" });
    }),
  );

  app.get(
    "/v1/instances/:pid/poll",
    asyncRoute(async (req, res) => {
      const instance = await getInstanceOr404(req, res);
      if (!instance) {
        return;
      }

      const inspect = await ipcClient.inspect(instance, {
        include_chat: parseBoolean(req.query.include_chat, true),
        include_summary: parseBoolean(req.query.include_summary, true),
        include_terminals: parseBoolean(req.query.include_terminals, true),
      });

      res.json(buildInstanceDetail(beaconStore.toPublicInstance(instance), inspect));
    }),
  );

  app.get(
    "/v1/instances/:pid/updates",
    asyncRoute(async (req, res) => {
      const firstInstance = await getInstanceOr404(req, res);
      if (!firstInstance) {
        return;
      }

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

  app.use((error, _req, res, _next) => {
    if (res.headersSent) {
      return;
    }

    res.status(500).json({
      error: "internal_error",
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
    pairing_code: activePairing.code,
    pairing_expires_at_ms: activePairing.expires_at_ms,
  };
}

export function createMagicHatApp(options = {}) {
  return createMagicHatRuntime(options).app;
}
