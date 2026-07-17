/**
 * Runs once when the server boots.
 *  - Seals Object/Array prototypes: blocks adding new properties to them,
 *    which is the prototype-pollution attack vector (the pinned npm xlsx
 *    build has a known advisory there; parsers are only reachable by
 *    authenticated users — this removes most of the remaining risk).
 *    Seal (not freeze): existing properties stay writable, which some
 *    legitimate libraries (e.g. Prisma's loader) rely on.
 *  - Takes a database snapshot on boot and every 24h thereafter, rotated
 *    on disk next to the database (download offsite copies from Settings).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  Object.seal(Object.prototype);
  Object.seal(Array.prototype);

  const { backupDatabase } = await import("./lib/backup");
  const run = async (label: string) => {
    try {
      const file = await backupDatabase();
      if (file) console.log(`backup: ${label} snapshot written to ${file}`);
    } catch (e) {
      console.error(`backup: ${label} snapshot failed:`, e);
    }
  };

  // boot backup after a short delay (lets the first request warm things up)
  setTimeout(() => run("boot"), 30_000).unref?.();
  setInterval(() => run("daily"), 24 * 60 * 60 * 1000).unref?.();

  // Meta (IG/FB) content worker: publish due posts every minute, refresh
  // post analytics twice a day. No-ops unless META_* env vars are set.
  const { runPublisherTick, runMetricsRefresh, metaConfigured } = await import("./lib/meta");
  if (metaConfigured()) {
    const tick = () => runPublisherTick().catch((e) => console.error("meta: publisher tick failed:", e));
    const refresh = () =>
      runMetricsRefresh()
        .then((r) => console.log(`meta: refreshed metrics for ${r.updated} posts`))
        .catch((e) => console.error("meta: metrics refresh failed:", e));
    setInterval(tick, 60 * 1000).unref?.();
    setTimeout(refresh, 60_000).unref?.();
    setInterval(refresh, 12 * 60 * 60 * 1000).unref?.();
    console.log("meta: publish worker armed (1m tick) + analytics refresh (12h)");
  }
}
