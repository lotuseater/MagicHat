import { startHostServer } from "./server.js";

async function main() {
  const { runtime } = await startHostServer();
  // Print explicit LAN endpoint for mobile pairing/setup flows.
  console.log(`MagicHat host listening on http://${runtime.config.listenHost}:${runtime.config.port}`);
  console.log(`Pairing code: ${runtime.pairing_code} (expires at ${new Date(runtime.pairing_expires_at_ms).toISOString()})`);
  if (runtime.config.remote.enabled && runtime.config.remote.relayUrl) {
    console.log(`Remote relay configured: ${runtime.config.remote.relayUrl}`);
    console.log("Generate a remote pairing QR/URI via GET /admin/v2/remote/status or POST /admin/v2/remote/bootstrap on localhost.");
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
