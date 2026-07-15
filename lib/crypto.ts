import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/** AES-256-GCM string sealing, keyed off AUTH_SECRET (for tokens at rest). */
const key = () => createHash("sha256").update(process.env.AUTH_SECRET ?? "denada-dev-secret").digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function unseal(sealed: string): string {
  const buf = Buffer.from(sealed, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
