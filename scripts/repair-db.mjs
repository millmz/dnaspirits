/**
 * One-time production repair for the July 2026 schema rebuild.
 *
 * The app was rebuilt from the original prototype schema to the De Nada
 * ex-works model, and the Prisma migration history was restarted. A database
 * created by the prototype has migration entries that no longer exist locally,
 * which makes `prisma migrate deploy` exit 1 on startup.
 *
 * This script runs before migrate deploy and handles exactly that case:
 *  - DB missing / empty ............................ OK, nothing to do
 *  - DB history matches local migrations ........... OK, nothing to do
 *  - DB is the old PROTOTYPE schema (no ExWorksSale
 *    table => only ever held demo seed data) ....... back it up, delete it,
 *                                                    let migrate recreate
 *  - Anything else (real De Nada data with a
 *    mismatched history) ........................... FAIL LOUDLY, never delete
 */
import { existsSync, copyFileSync, rmSync, readdirSync } from "fs";
import { dirname, isAbsolute, join } from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("file:")) {
  console.log("repair-db: non-SQLite DATABASE_URL, skipping.");
  process.exit(0);
}
// Prisma resolves relative sqlite paths against the schema directory
const rawPath = url.slice(5);
const dbPath = isAbsolute(rawPath) ? rawPath : join(root, "prisma", rawPath);

if (!existsSync(dbPath)) {
  console.log("repair-db: no database file yet, skipping.");
  process.exit(0);
}

const db = new PrismaClient();
try {
  const tables = (
    await db.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table'"
    )
  ).map((r) => r.name);

  if (tables.length === 0) {
    console.log("repair-db: empty database, skipping.");
    process.exit(0);
  }

  let applied = [];
  if (tables.includes("_prisma_migrations")) {
    applied = (
      await db.$queryRawUnsafe(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL"
      )
    ).map((r) => r.migration_name);
  }

  const local = readdirSync(join(root, "prisma", "migrations"), {
    withFileTypes: true,
  })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const orphaned = applied.filter((m) => !local.includes(m));
  if (orphaned.length === 0) {
    console.log("repair-db: migration history is consistent, nothing to do.");
    process.exit(0);
  }

  console.log(`repair-db: found orphaned migrations: ${orphaned.join(", ")}`);

  if (tables.includes("ExWorksSale")) {
    console.error(
      "repair-db: REFUSING to touch this database — it has the current schema " +
        "(ExWorksSale table exists) and may contain real data. Resolve the " +
        "migration mismatch manually (npx prisma migrate resolve)."
    );
    process.exit(1);
  }

  // Old prototype schema: only demo data ever lived here. Back up, then reset.
  const backup = `${dbPath}.pre-rebuild-backup-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  copyFileSync(dbPath, backup);
  rmSync(dbPath);
  rmSync(`${dbPath}-journal`, { force: true });
  console.log(
    `repair-db: prototype-era database backed up to ${backup} and removed; ` +
      "migrate deploy will recreate it fresh."
  );
  process.exit(0);
} finally {
  await db.$disconnect();
}
