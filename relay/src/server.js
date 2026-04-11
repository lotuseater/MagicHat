import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRelayRuntime } from "./app.js";

function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export async function startRelayServer(options = {}) {
  const runtime = await createRelayRuntime(options);
  const tlsCertPath = runtime.config.tls?.certPath || "";
  const tlsKeyPath = runtime.config.tls?.keyPath || "";
  const hasTlsConfig = Boolean(tlsCertPath || tlsKeyPath);
  let server;
  let scheme = "http";

  if (hasTlsConfig) {
    if (!tlsCertPath || !tlsKeyPath) {
      throw new Error("relay_tls_config_incomplete");
    }
    server = https.createServer(
      {
        cert: fs.readFileSync(tlsCertPath),
        key: fs.readFileSync(tlsKeyPath),
      },
      runtime.app,
    );
    scheme = "https";
  } else {
    const insecureAllowed = runtime.config.allowInsecureHttp || isLoopbackHost(runtime.config.listenHost);
    if (!insecureAllowed) {
      throw new Error("relay_tls_required");
    }
    server = http.createServer(runtime.app);
  }
  runtime.attachServer(server);

  await new Promise((resolve, reject) => {
    server.listen(runtime.config.port, runtime.config.listenHost, resolve);
    server.on("error", reject);
  });

  return {
    runtime,
    server,
    scheme,
    async close() {
      await runtime.close();
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
