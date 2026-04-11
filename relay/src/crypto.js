import crypto from "node:crypto";

export function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function randomToken(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

export function randomChallenge() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function nowMs() {
  return Date.now();
}

export function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

export function base64UrlDecodeToString(value) {
  return base64UrlDecode(value).toString("utf8");
}

export function verifyDetachedSignature(message, signature, publicKeyPem) {
  const publicKey =
    typeof publicKeyPem === "string" && publicKeyPem.includes("BEGIN")
      ? publicKeyPem
      : crypto.createPublicKey({
          key: Buffer.from(publicKeyPem, "base64"),
          format: "der",
          type: "spki",
        });
  return crypto.verify(
    null,
    Buffer.from(message, "utf8"),
    publicKey,
    base64UrlDecode(signature),
  );
}

export function fingerprintForPublicKey(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return `sha256:${crypto.createHash("sha256").update(der).digest("hex")}`;
}

export function verifyBootstrapToken(token, publicKeyPem) {
  const [encodedPayload, encodedSignature] = `${token || ""}`.split(".");
  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  const verified = verifyDetachedSignature(encodedPayload, encodedSignature, publicKeyPem);
  if (!verified) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    return null;
  }
}
