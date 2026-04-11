import { startRelayServer } from "./server.js";

async function main() {
  const { runtime, scheme } = await startRelayServer();
  console.log(`MagicHat relay listening on ${scheme}://${runtime.config.listenHost}:${runtime.config.port}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
