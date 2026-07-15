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
}
