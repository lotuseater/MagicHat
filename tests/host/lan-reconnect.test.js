import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TeamAppIpcClient } from "../../host/src/teamapp/ipcClient.js";

describe("LAN disconnect/reconnect stream cursor", () => {
  const dirs = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("resumes events from cursor after reconnect", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "magichat-reconnect-"));
    dirs.push(dir);

    const eventsPath = path.join(dir, "events.jsonl");
    const instance = {
      pid: 501,
      cmd_path: path.join(dir, "cmd.json"),
      resp_path: path.join(dir, "resp.jsonl"),
      events_path: eventsPath,
    };

    await fs.writeFile(
      eventsPath,
      `${JSON.stringify({ type: "agent_status", status: "running" })}\n`,
      "utf8",
    );

    const client = new TeamAppIpcClient();

    const first = await client.tailEvents(instance, 0);
    expect(first.events).toHaveLength(1);
    expect(first.next_cursor).toBe(1);

    await fs.appendFile(
      eventsPath,
      `${JSON.stringify({ type: "agent_status", status: "completed" })}\n`,
      "utf8",
    );

    const second = await client.tailEvents(instance, first.next_cursor);
    expect(second.events).toHaveLength(1);
    expect(second.events[0].status).toBe("completed");
    expect(second.next_cursor).toBe(2);
  });
});
