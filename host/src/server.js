import { createMagicHatRuntime } from "./app.js";

export async function startHostServer(options = {}) {
  const runtime = createMagicHatRuntime(options);
  const { config } = runtime;

  if (process.platform !== "win32" && !config.allowNonWindows && !options.allowNonWindows) {
    throw new Error("magichat_host_is_windows_only");
  }

  const server = await new Promise((resolve, reject) => {
    const instance = runtime.app.listen(config.port, config.listenHost, () => resolve(instance));
    instance.on("error", reject);
  });

  return {
    runtime,
    server,
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
    },
  };
}
