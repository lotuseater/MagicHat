import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyBootstrapToken, verifyDetachedSignature } from "../src/crypto.js";

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("relay crypto helpers", () => {
  it("verifies host-signed bootstrap tokens", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const payload = {
      v: 2,
      jti: "bt_test",
      host_id: "host_test",
      host_name: "Office PC",
      exp: "2026-04-11T20:30:00Z",
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = crypto.sign(null, Buffer.from(encodedPayload, "utf8"), privateKey);
    const token = `${encodedPayload}.${base64UrlEncode(signature)}`;

    const verified = verifyBootstrapToken(
      token,
      publicKey.export({ type: "spki", format: "pem" }),
    );

    expect(verified).toEqual(payload);
  });

  it("accepts device signatures using base64 SPKI public keys", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const signature = crypto.sign(null, Buffer.from("challenge-1", "utf8"), privateKey);

    expect(verifyDetachedSignature("challenge-1", base64UrlEncode(signature), publicKeyBase64)).toBe(true);
  });
});
