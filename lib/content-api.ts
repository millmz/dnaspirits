import { createHash, timingSafeEqual } from "crypto";
import { isRateLimited, recordHit } from "./rate-limit";

/**
 * Auth for the content surfaces that an external agent (e.g. a ChatGPT brand
 * manager) calls — the REST API (/api/content) and the MCP endpoint
 * (/api/mcp/[key]). Deliberately scoped to CONTENT ONLY — this key can read
 * and draft social posts and nothing else. It never touches financials, the
 * cap table, depletions, customers, or any other data. A missing
 * CONTENT_API_KEY means both surfaces are off.
 */

const WINDOW_MS = 60 * 1000;
const MAX_PER_MINUTE = 60;

export type ApiAuth =
  | { ok: true }
  | { ok: false; status: number; message: string };

/** Constant-time token comparison (hashes first so lengths never leak). */
function tokenMatches(supplied: string, configured: string): boolean {
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(configured).digest();
  return timingSafeEqual(a, b);
}

/** Validate a raw token (from a Bearer header or a URL path segment). */
export function authContentToken(token: string): ApiAuth {
  const configured = process.env.CONTENT_API_KEY;
  if (!configured) {
    return { ok: false, status: 503, message: "Content API is not enabled (set CONTENT_API_KEY)." };
  }
  if (!token || !tokenMatches(token, configured)) {
    return { ok: false, status: 401, message: "Invalid or missing API key." };
  }
  // rate limit per key
  const key = `content-api:${token.slice(0, 8)}`;
  if (isRateLimited(key, MAX_PER_MINUTE, WINDOW_MS)) {
    return { ok: false, status: 429, message: "Rate limit exceeded — try again shortly." };
  }
  recordHit(key, WINDOW_MS);
  return { ok: true };
}

export function authContentApi(req: Request): ApiAuth {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return authContentToken(token);
}
