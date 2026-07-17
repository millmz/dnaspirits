import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Minimal RFC 6238 TOTP (the standard used by Google Authenticator, 1Password,
 * Authy, etc.) — no dependency needed. 6 digits, 30-second steps, HMAC-SHA1
 * (what every authenticator app expects).
 */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Fresh 160-bit secret, base32-encoded for authenticator apps. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 6-digit code for a given 30s time step (default: now). */
export function totpCode(secretB32: string, step?: number): string {
  const counter = step ?? Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Constant-time check of a submitted code, allowing ±1 step of clock drift. */
export function verifyTotp(secretB32: string, code: string, window = 1): boolean {
  const submitted = code.replace(/\D/g, "");
  if (submitted.length !== DIGITS) return false;
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  let ok = false;
  for (let w = -window; w <= window; w++) {
    const expected = totpCode(secretB32, now + w);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(submitted))) ok = true;
  }
  return ok;
}

/** Link that opens directly in an authenticator app on the same phone. */
export function otpauthUrl(email: string, secretB32: string): string {
  const issuer = encodeURIComponent("De Nada Ops");
  return `otpauth://totp/${issuer}:${encodeURIComponent(email)}?secret=${secretB32}&issuer=${issuer}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
