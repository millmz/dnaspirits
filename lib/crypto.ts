import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * AES-256-GCM string sealing for secrets at rest (QBO OAuth tokens, TOTP
 * secrets). Keyed off DATA_ENCRYPTION_KEY when set, else AUTH_SECRET —
 * setting a dedicated key means AUTH_SECRET can be rotated (which signs
 * everyone out) without destroying sealed data. `unseal` also tries the
 * AUTH_SECRET-derived key as a fallback, so turning on DATA_ENCRYPTION_KEY
 * on an existing deployment keeps old sealed values readable.
 */
const derive = (s: string) => createHash("sha256").update(s).digest();

function keyChain(): Buffer[] {
  const primary = process.env.DATA_ENCRYPTION_KEY;
  const legacy = process.env.AUTH_SECRET;
  const chain: Buffer[] = [];
  if (primary && primary.length >= 16) chain.push(derive(primary));
  if (legacy && legacy.length >= 16) chain.push(derive(legacy));
  if (chain.length === 0) {
    // Never run production on a guessable fallback key.
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATA_ENCRYPTION_KEY or AUTH_SECRET must be set (>=16 chars) in production");
    }
    chain.push(derive("denada-dev-secret"));
  }
  return chain;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyChain()[0], iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function unseal(sealed: string): string {
  const buf = Buffer.from(sealed, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const keys = keyChain();
  for (let i = 0; i < keys.length; i++) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", keys[i], iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    } catch (e) {
      if (i === keys.length - 1) throw e;
    }
  }
  throw new Error("unreachable");
}
