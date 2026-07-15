import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { dirname, isAbsolute, join, basename } from "path";
import { db } from "./db";

const KEEP = 14; // daily snapshots retained on disk

function dbPath(): string | null {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return null;
  const raw = url.slice(5);
  // Prisma resolves relative sqlite paths against the schema directory
  return isAbsolute(raw) ? raw : join(process.cwd(), "prisma", raw);
}

export function backupDir(): string | null {
  const p = dbPath();
  return p ? join(dirname(p), "backups") : null;
}

/**
 * Takes a consistent snapshot of the SQLite database via VACUUM INTO (safe
 * while the app is running — it copies a transactionally consistent image,
 * compacted). Keeps the most recent {KEEP} snapshots and prunes the rest.
 */
export async function backupDatabase(): Promise<string | null> {
  const dir = backupDir();
  if (!dir) return null; // non-SQLite database — use the provider's backups
  mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = join(dir, `denada-${stamp}.db`);
  if (existsSync(target)) return target; // same-second duplicate

  await db.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  // rotate
  const files = listBackups();
  for (const f of files.slice(KEEP)) {
    rmSync(join(dir, f.name), { force: true });
  }
  return target;
}

export function listBackups(): { name: string; bytes: number; mtime: Date }[] {
  const dir = backupDir();
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^denada-[\w-]+\.db$/.test(f))
    .map((name) => {
      const s = statSync(join(dir, name));
      return { name: basename(name), bytes: s.size, mtime: s.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}
