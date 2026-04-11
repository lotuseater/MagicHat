import { describe, expect, it, vi } from "vitest";
import {
  enforceLanOnly,
  isLanAddress,
  normalizeRemoteAddress,
} from "../../host/src/network/lanGuard.js";

describe("LAN binding policy", () => {
  it("accepts private and loopback addresses", () => {
    expect(isLanAddress("192.168.1.20")).toBe(true);
    expect(isLanAddress("10.0.0.5")).toBe(true);
    expect(isLanAddress("::1")).toBe(true);
    expect(isLanAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLanAddress("172.20.10.2")).toBe(true);
  });

  it("rejects public addresses", () => {
    expect(isLanAddress("8.8.8.8")).toBe(false);
    expect(isLanAddress("1.1.1.1")).toBe(false);
    expect(isLanAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("normalizes mapped ipv6 remote addresses", () => {
    expect(normalizeRemoteAddress("::ffff:192.168.1.9")).toBe("192.168.1.9");
  });

  it("middleware blocks non-LAN clients", () => {
    const middleware = enforceLanOnly();

    const req = { socket: { remoteAddress: "8.8.8.8" } };
    const res = {
      code: 200,
      payload: null,
      status(statusCode) {
        this.code = statusCode;
        return this;
      },
      json(data) {
        this.payload = data;
        return this;
      },
    };

    const next = vi.fn();
    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(403);
    expect(res.payload.error).toBe("forbidden_non_lan_client");
  });
});
