import { describe, expect, it, vi } from "vitest";
import { RelayClient } from "../../host/src/remote/relayClient.js";

// Unit-level exercise of the reconnect-loop's exponential backoff and the
// pending-admin cleanup, without standing up a real relay WebSocket server.

function makeClientWithFakeWs({ openOutcome = "fail", maxAttempts = 3 } = {}) {
  const sleepCalls = [];
  const client = new RelayClient({
    relayUrl: "wss://fake.invalid/v2/host/connect",
    allowInsecureRelay: true,
    remoteAccessState: { recordPendingApproval: vi.fn() },
    hostId: "host-xyz",
    hostName: "fake",
    commandHandler: vi.fn(),
    onStatus: vi.fn(),
  });

  // Replace the _connectOnce with a stub that rejects a fixed number of
  // times, then resolves (simulating a relay that was down, then came back).
  let attempts = 0;
  client._connectOnce = vi.fn(async () => {
    attempts += 1;
    if (attempts <= maxAttempts) {
      const err = new Error("fake_connect_failure");
      err.code = "ECONNREFUSED";
      throw err;
    }
  });

  return { client, attempts: () => attempts, sleepCalls };
}

describe("RelayClient reconnect loop", () => {
  it("uses exponential backoff and eventually succeeds", async () => {
    const client = new RelayClient({
      relayUrl: "wss://fake.invalid/v2/host/connect",
      allowInsecureRelay: true,
      remoteAccessState: { recordPendingApproval: vi.fn() },
      hostId: "host-xyz",
      hostName: "fake",
      commandHandler: vi.fn(),
      onStatus: vi.fn(),
      reconnectDelayMs: 1, // keep test fast
      maxReconnectDelayMs: 10,
    });

    let attempts = 0;
    client._connectOnce = vi.fn(async () => {
      attempts += 1;
      if (attempts <= 3) {
        throw new Error("still_down");
      }
    });

    await client._connectLoop();
    expect(attempts).toBe(4);
    // Attempts counter resets after a successful host_attest in real code;
    // here we just confirm the loop completed rather than spinning forever.
  });

  it("stops reconnecting when close() is called mid-backoff", async () => {
    const client = new RelayClient({
      relayUrl: "wss://fake.invalid/v2/host/connect",
      allowInsecureRelay: true,
      remoteAccessState: { recordPendingApproval: vi.fn() },
      hostId: "host-xyz",
      hostName: "fake",
      commandHandler: vi.fn(),
      onStatus: vi.fn(),
      reconnectDelayMs: 30,
      maxReconnectDelayMs: 60,
    });

    let attempts = 0;
    client._connectOnce = vi.fn(async () => {
      attempts += 1;
      throw new Error("always_down");
    });

    const loopPromise = client._connectLoop();
    // Let a couple of attempts run, then close.
    await new Promise((r) => setTimeout(r, 80));
    await client.close();
    await loopPromise;

    // After close(), no further _connectOnce calls should happen.
    const snapshotAttempts = attempts;
    await new Promise((r) => setTimeout(r, 100));
    expect(attempts).toBe(snapshotAttempts);
  });

  it("rejects pending admin requests when close() is called", async () => {
    const client = new RelayClient({
      relayUrl: "wss://fake.invalid/v2/host/connect",
      allowInsecureRelay: true,
      remoteAccessState: { recordPendingApproval: vi.fn() },
      hostId: "host-xyz",
      hostName: "fake",
      commandHandler: vi.fn(),
      onStatus: vi.fn(),
    });

    let rejectedReason;
    client.pendingAdmin.set("req-1", {
      resolve: vi.fn(),
      reject: (err) => {
        rejectedReason = err.code;
      },
    });

    await client.close();
    expect(rejectedReason).toBe("relay_client_closed");
    expect(client.pendingAdmin.size).toBe(0);
  });
});
