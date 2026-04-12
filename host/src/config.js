import os from "node:os";
import path from "node:path";

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(raw) {
  if (!raw || !raw.trim()) {
    return [];
  }

  const args = [];
  let current = "";
  let quote = null;

  for (const char of raw.trim()) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (quote && char === quote) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

export function readHostConfig(env = process.env) {
  const tempRoot = env.TEMP || env.TMP || os.tmpdir();
  const statePath =
    env.MAGICHAT_STATE_PATH ||
    path.join(tempRoot, "wizard_team_app", "magichat_host_state.json");

  return {
    listenHost: env.MAGICHAT_BIND_HOST || "0.0.0.0",
    port: parsePositiveInt(env.MAGICHAT_PORT, 18765),
    beaconPath:
      env.MAGICHAT_BEACON_PATH ||
      path.join(tempRoot, "wizard_team_app", "active_instances.json"),
    pairingCodeTtlMs: parsePositiveInt(env.MAGICHAT_PAIRING_TTL_MS, 5 * 60 * 1000),
    tokenTtlMs: parsePositiveInt(env.MAGICHAT_TOKEN_TTL_MS, 24 * 60 * 60 * 1000),
    statePath,
    launch: {
      command: env.MAGICHAT_TEAM_APP_CMD || "",
      args: parseArgs(env.MAGICHAT_TEAM_APP_ARGS || ""),
      cwd: env.MAGICHAT_TEAM_APP_CWD || process.cwd(),
      waitMs: parsePositiveInt(env.MAGICHAT_LAUNCH_WAIT_MS, 15000),
      automationPrefixBase:
        env.MAGICHAT_TEAM_APP_AUTOMATION_PREFIX_BASE || "magichat_team_app",
      automationTempRoot:
        env.MAGICHAT_TEAM_APP_AUTOMATION_TEMP_ROOT ||
        path.join(tempRoot, "wizard_team_app", "magichat", "transient"),
      runArtifactRoot:
        env.MAGICHAT_TEAM_APP_RUN_ROOT ||
        path.join(path.dirname(statePath), "team_app_runs"),
      noActivate: env.MAGICHAT_TEAM_APP_NO_ACTIVATE !== "0",
      headlessPrompts: env.MAGICHAT_TEAM_APP_HEADLESS_PROMPTS !== "0",
      keepAutomationArtifacts: env.MAGICHAT_TEAM_APP_KEEP_AUTOMATION_ARTIFACTS !== "0",
    },
    allowNonWindows: env.MAGICHAT_ALLOW_NON_WINDOWS === "1",
    remote: {
      enabled: env.MAGICHAT_REMOTE_ENABLED === "1" || !!env.MAGICHAT_RELAY_URL,
      relayUrl: env.MAGICHAT_RELAY_URL || "",
      allowInsecureRelay: env.MAGICHAT_ALLOW_INSECURE_RELAY === "1",
      remoteStatePath:
        env.MAGICHAT_REMOTE_STATE_PATH ||
        path.join(path.dirname(statePath), "magichat_remote_state.json"),
      bootstrapTtlMs: parsePositiveInt(env.MAGICHAT_REMOTE_BOOTSTRAP_TTL_MS, 10 * 60 * 1000),
    },
  };
}
