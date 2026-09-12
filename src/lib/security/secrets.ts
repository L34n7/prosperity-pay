import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env, requireEnv } from "@/lib/env";

function key() {
  const decoded = Buffer.from(
    requireEnv(env.financialEncryptionKey, "FINANCIAL_ENCRYPTION_KEY"),
    "base64",
  );
  if (decoded.length !== 32) {
    throw new Error("FINANCIAL_ENCRYPTION_KEY deve conter 32 bytes em base64.");
  }
  return decoded;
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Segredo criptografado invalido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
