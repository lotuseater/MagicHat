import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { startHostServer } from "../../host/src/server.js";
import { createWorkspace } from "./_helpers.js";

describe("windows-only host policy", () => {
  it("rejects non-Windows startup unless override is enabled", async () => {
    if (process.platform === "win32") {
      expect(true).toBe(true);
      return;
    }

    const workspace = await createWorkspace();
    try {
      await expect(
        startHostServer({
          config: {
            ...workspace.config,
            allowNonWindows: false,
          },
        }),
      ).rejects.toThrow("magichat_host_is_windows_only");
    } finally {
      await fs.rm(workspace.root, { recursive: true, force: true });
    }
  });
});
