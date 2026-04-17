import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      express: fileURLToPath(new URL("./node_modules/express/index.js", import.meta.url)),
      ws: fileURLToPath(new URL("./node_modules/ws/wrapper.mjs", import.meta.url)),
      pg: fileURLToPath(new URL("./node_modules/pg/lib/index.js", import.meta.url)),
      "better-sqlite3": fileURLToPath(
        new URL("./node_modules/better-sqlite3/lib/index.js", import.meta.url),
      ),
    },
  },
  test: {
    include: ["../tests/**/*.test.js"],
    environment: "node",
    globals: true,
  },
});
