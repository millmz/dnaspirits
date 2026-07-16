import { isRateLimited, recordHit } from "./rate-limit";

/**
 * Auth for the content API that an external agent (e.g. a ChatGPT brand
 * manager) calls. Deliberately scoped to CONTENT ONLY — this key can read and
 * draft social posts and nothing else. It never touches financials, the cap
 * table, depletions, customers, or any other data. A missing CONTENT_API_KEY
 * means the API is off.
 */

const WINDOW_MS = 60 * 1000;
const MAX_PER_MINUTE = 60;

export type ApiAuth =
  | { ok: true }
  | { ok: false; status: number; message: string };

export function authContentApi(req: Request): ApiAuth {
  const configured = process.env.CONTENT_API_KEY;
  if (!configured) {
    return { ok: false, status: 503, message: "Content API is not enabled (set CONTENT_API_KEY)." };
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token !== configured) {
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
