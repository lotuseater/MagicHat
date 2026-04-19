import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readHostConfig } from "../../host/src/config.js";

describe("host config team app command resolution", () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length) {
      await cleanup.pop()().catch(() => {});
    }
  });

  it("prefers the console binary when both team app binaries are present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-config-"));
    cleanup.push(() => fs.rm(root, { recursive: true, force: true }));

    const buildDir = path.join(root, "build");
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(path.join(buildDir, "wizard_team_app_console.exe"), "console");
    await fs.writeFile(path.join(buildDir, "wizard_team_app.exe"), "gui");

    const config = readHostConfig({
      TEMP: root,
      MAGICHAT_TEAM_APP_CWD: root,
    });

    expect(config.launch.command).toBe(path.join(buildDir, "wizard_team_app_console.exe"));
  });
});
