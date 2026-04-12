import { spawn } from "node:child_process";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveMacBundleTarget(command) {
  if (!command || !command.endsWith(".app")) {
    return null;
  }
  return command;
}

export class ProcessController {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.spawnImpl = options.spawnImpl || spawn;
    this.waitImpl = options.waitImpl || wait;
  }

  isRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code === "EPERM";
    }
  }

  async _waitForExit(pid, timeoutMs = 4000, pollMs = 120) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.isRunning(pid)) {
        return true;
      }
      await this.waitImpl(pollMs);
    }
    return !this.isRunning(pid);
  }

  _runCommand(command, args = []) {
    return new Promise((resolve) => {
      const child = this.spawnImpl(command, args, {
        stdio: "ignore",
        windowsHide: true,
      });

      child.on("error", () => resolve(false));
      child.on("exit", () => resolve(true));
    });
  }

  async closeGracefully(pid, timeoutMs = 5000) {
    if (!this.isRunning(pid)) {
      return true;
    }

    if (this.platform === "win32") {
      const closeScript = [
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
        "if ($p -and $p.MainWindowHandle -ne 0) { $null = $p.CloseMainWindow() }",
      ].join("; ");
      await this._runCommand("powershell.exe", ["-NoProfile", "-Command", closeScript]);
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        return true;
      }
    }

    return this._waitForExit(pid, timeoutMs);
  }

  async forceKill(pid, timeoutMs = 3000) {
    if (!this.isRunning(pid)) {
      return true;
    }

    if (this.platform === "win32") {
      await this._runCommand("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        return true;
      }
    }

    return this._waitForExit(pid, timeoutMs);
  }

  launch(launchConfig) {
    if (!launchConfig?.command) {
      throw new Error("launch_command_not_configured");
    }

    let command = launchConfig.command;
    let args = launchConfig.args || [];
    if (this.platform === "darwin") {
      const bundlePath = resolveMacBundleTarget(launchConfig.command);
      if (bundlePath) {
        command = "open";
        args = ["-n", "-a", bundlePath, ...(args.length > 0 ? ["--args", ...args] : [])];
      }
    }

    const env = {
      ...process.env,
      ...(launchConfig.env || {}),
    };

    this.spawnImpl(command, args, {
      cwd: launchConfig.cwd,
      detached: this.platform === "darwin" ? false : true,
      env,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  }
}
