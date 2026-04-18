import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntime, pairDevice } from "./_helpers.js";

describe("error envelope scrubbing on /v1 routes", () => {
  const contexts = [];

  afterEach(async () => {
    while (contexts.length) {
      await contexts.pop().cleanup();
    }
  });

  it("does not leak unknown error details (host paths, stack traces) to clients", async () => {
    // browserControlService.listPages throws an error whose message includes a
    // file path + a bearer token, simulating how downstream errors can carry
    // host internals. The error envelope must scrub everything.
    const ctx = await createRuntime({
      browserControlService: {
        listPages: vi.fn(async () => {
          const error = new Error(
            "EACCES: open 'C:\\\\Users\\\\Oleh\\\\secret.json' with Authorization: Bearer secrett0ken",
          );
          error.code = "EACCES";
          throw error;
        }),
      },
    });
    contexts.push(ctx);
    const token = await pairDevice(ctx);

    const response = await ctx.http.get("/v1/browser/pages", { token });
    expect(response.status).toBe(500);
    expect(response.body.error).toBe("internal_error");
    expect(JSON.stringify(response.body)).not.toContain("secret.json");
    expect(JSON.stringify(response.body)).not.toContain("secrett0ken");
    expect(JSON.stringify(response.body)).not.toContain("Oleh");
  });

  it("forwards caller-actionable details for known error codes", async () => {
    const ctx = await createRuntime({});
    contexts.push(ctx);
    const token = await pairDevice(ctx);

    // Unknown CLI instance id triggers cli_instance_not_found (a safe, known code).
    const response = await ctx.http.get("/v1/cli-instances/does-not-exist", { token });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("cli_instance_not_found");
  });
});
