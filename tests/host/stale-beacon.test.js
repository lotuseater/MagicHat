import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBeaconEntry, createRuntime, pairDevice } from "./_helpers.js";

describe("stale beacon handling", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length > 0) {
      await contexts.pop().cleanup();
    }
  });

  it("prunes stale instances before returning list", async () => {
    const alivePid = 101;
    const stalePid = 202;

    const ctx = await createRuntime({
      beaconEntries: [buildBeaconEntry({ pid: alivePid }), buildBeaconEntry({ pid: stalePid })],
      processProbe: vi.fn((pid) => pid === alivePid),
    });
    contexts.push(ctx);

    const token = await pairDevice(ctx);
    const response = await ctx.http.get("/v1/instances", { token });

    expect(response.status).toBe(200);
    expect(response.body.instances).toHaveLength(1);
    expect(response.body.instances[0].pid).toBe(alivePid);

    const persisted = JSON.parse(await fs.readFile(ctx.workspace.beaconPath, "utf8"));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].pid).toBe(alivePid);
  });
});
