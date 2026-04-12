import { describe, expect, it, vi } from "vitest";
import { ProcessController } from "../../host/src/lifecycle/processController.js";

describe("process controller launch", () => {
  it("launches macOS bundle executables directly so automation env is preserved", () => {
    const child = { unref: vi.fn() };
    const spawnImpl = vi.fn(() => child);
    const controller = new ProcessController({
      platform: "darwin",
      spawnImpl,
    });

    controller.launch({
      command: "/Applications/Wizard Team App.app/Contents/MacOS/wizard_team_app",
      args: ["--restore-run", "/tmp/session_restore.json"],
      cwd: "/tmp",
      env: { MAGICHAT_TEST: "1" },
    });

    expect(spawnImpl).toHaveBeenCalledWith(
      "/Applications/Wizard Team App.app/Contents/MacOS/wizard_team_app",
      ["--restore-run", "/tmp/session_restore.json"],
      expect.objectContaining({
        cwd: "/tmp",
        detached: false,
        env: expect.objectContaining({
          MAGICHAT_TEST: "1",
        }),
        stdio: "ignore",
      }),
    );
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it("launches .app bundle targets through open on macOS", () => {
    const child = { unref: vi.fn() };
    const spawnImpl = vi.fn(() => child);
    const controller = new ProcessController({
      platform: "darwin",
      spawnImpl,
    });

    controller.launch({
      command: "/Applications/Wizard Team App.app",
      args: ["--restore-run", "/tmp/session_restore.json"],
      cwd: "/tmp",
    });

    expect(spawnImpl).toHaveBeenCalledWith(
      "open",
      [
        "-n",
        "-a",
        "/Applications/Wizard Team App.app",
        "--args",
        "--restore-run",
        "/tmp/session_restore.json",
      ],
      expect.objectContaining({
        cwd: "/tmp",
        detached: false,
        env: expect.any(Object),
        stdio: "ignore",
      }),
    );
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it("launches non-bundle commands directly", () => {
    const child = { unref: vi.fn() };
    const spawnImpl = vi.fn(() => child);
    const controller = new ProcessController({
      platform: "linux",
      spawnImpl,
    });

    controller.launch({
      command: "team-app",
      args: ["--headless"],
      cwd: "/workspace",
      env: { MAGICHAT_TEST: "1" },
    });

    expect(spawnImpl).toHaveBeenCalledWith(
      "team-app",
      ["--headless"],
      expect.objectContaining({
        cwd: "/workspace",
        detached: true,
        env: expect.objectContaining({
          MAGICHAT_TEST: "1",
        }),
        stdio: "ignore",
      }),
    );
    expect(child.unref).toHaveBeenCalledTimes(1);
  });
});
