import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Integration tokens are encrypted at rest (spec 2) with AES-256-GCM.
 * The key is 32 bytes, base64, from the INTEGRATIONS_KEY server env var.
 * Format: "v1.<iv>.<tag>.<ciphertext>", each part base64url.
 */
export function parseKey(base64: string | undefined): Buffer {
  if (!base64) throw new Error("INTEGRATIONS_KEY is not set.");
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("INTEGRATIONS_KEY must be 32 bytes, base64 encoded.");
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(sealed: string, key: Buffer): string {
  const [version, iv, tag, ct] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognized secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
