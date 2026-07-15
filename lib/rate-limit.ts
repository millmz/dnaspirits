/**
 * In-memory sliding-window rate limiter (single-instance deployment).
 * Used to slow credential-stuffing and brute-force attempts on login.
 */
const buckets = new Map<string, number[]>();

function prune(now: number, windowMs: number, hits: number[]) {
  while (hits.length > 0 && now - hits[0] > windowMs) hits.shift();
}

/** True if `key` has recorded >= max hits inside the window. */
export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = buckets.get(key);
  if (!hits) return false;
  prune(now, windowMs, hits);
  return hits.length >= max;
}

/** Record a hit (e.g. a failed login) against `key`. */
export function recordHit(key: string, windowMs: number) {
  const now = Date.now();
  const hits = buckets.get(key) ?? [];
  prune(now, windowMs, hits);
  hits.push(now);
  buckets.set(key, hits);
  // opportunistic cleanup so the map can't grow unbounded
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      prune(now, windowMs, v);
      if (v.length === 0) buckets.delete(k);
    }
  }
}

/** Clear hits for `key` (e.g. after a successful login). */
export function clearHits(key: string) {
  buckets.delete(key);
}
