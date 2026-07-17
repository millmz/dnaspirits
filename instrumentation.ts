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

  // Offsite copies (DB snapshot + media) to the S3-compatible bucket, if
  // configured — the local disk is a single point of failure without this.
  const { runOffsiteBackup, offsiteConfigured, diskUsage } = await import("./lib/offsite");
  if (offsiteConfigured()) {
    const offsite = () =>
      runOffsiteBackup()
        .then((s) =>
          console.log(
            `offsite: snapshot ${s.snapshot || "FAILED"}, media +${s.mediaUploaded}/${s.mediaSkipped} existing` +
              (s.errors.length ? `, errors: ${s.errors.join("; ")}` : "")
          )
        )
        .catch((e) => console.error("offsite backup failed:", e));
    setTimeout(offsite, 90_000).unref?.();
    setInterval(offsite, 24 * 60 * 60 * 1000).unref?.();
    console.log("offsite: nightly S3 backup armed");
  } else {
    console.warn("offsite: OFFSITE_S3_* not set — backups exist only on the local disk");
  }
  // QuickBooks keep-alive: weekly sync refreshes the OAuth tokens so the
  // ~100-day refresh-token window never lapses from disuse, and keeps the
  // P&L data current without anyone clicking Sync.
  const { qboConfigured, qboConnection, qboSyncYear } = await import("./lib/qbo");
  if (qboConfigured()) {
    const qboSync = async () => {
      try {
        if (!(await qboConnection())) return;
        const year = new Date().getFullYear();
        const r = await qboSyncYear(year);
        console.log(`qbo: weekly sync pulled ${r.rows} P&L lines across ${r.periods} month(s)`);
      } catch (e) {
        console.error("qbo: weekly sync failed:", e);
      }
    };
    setTimeout(qboSync, 3 * 60 * 1000).unref?.();
    setInterval(qboSync, 7 * 24 * 60 * 60 * 1000).unref?.();
    console.log("qbo: weekly auto-sync armed");
  }

  const disk = diskUsage();
  if (disk && disk.usedPct >= 85) {
    console.warn(`disk: data volume ${disk.usedPct}% full — clean up or resize soon`);
  }

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
