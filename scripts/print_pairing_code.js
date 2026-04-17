#!/usr/bin/env node
// Print the MagicHat host's active pairing code without starting a server.
// Reads the persisted pairing state directly; issues a fresh code if none is active.
//
// Usage:
//   node scripts/print_pairing_code.js
//   node scripts/print_pairing_code.js --json
//   MAGICHAT_STATE_PATH=... node scripts/print_pairing_code.js

import { readHostConfig } from "../host/src/config.js";
import { PairingManager } from "../host/src/auth/pairingManager.js";

function formatExpiry(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  return new Date(ms).toISOString();
}

function main() {
  const config = readHostConfig();
  const pairingManager = new PairingManager({
    statePath: config.statePath,
    pairingCodeTtlMs: config.pairingCodeTtlMs,
    tokenTtlMs: config.tokenTtlMs,
  });

  const pairing = pairingManager.getActivePairingCode();
  const asJson = process.argv.includes("--json");

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({
        pairing_code: pairing.code,
        issued_at_ms: pairing.issued_at_ms,
        expires_at_ms: pairing.expires_at_ms,
        state_path: config.statePath,
        port: config.port,
      }, null, 2)}\n`,
    );
    return;
  }

  console.log(`Pairing code : ${pairing.code}`);
  console.log(`Expires at   : ${formatExpiry(pairing.expires_at_ms)}`);
  console.log(`State path   : ${config.statePath}`);
  console.log(`Host port    : ${config.port}`);
}

main();
