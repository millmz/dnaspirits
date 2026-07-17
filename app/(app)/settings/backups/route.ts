import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { join } from "path";
import { requireAdmin } from "@/lib/auth";
import { listBackups, backupDir } from "@/lib/backup";

/** Admin-only download of a database snapshot, for offsite copies. */
export async function GET(req: NextRequest) {
  await requireAdmin();
  const file = req.nextUrl.searchParams.get("file") ?? "";
  // only files that actually exist in the backups listing — no path input is
  // ever used directly, so traversal is impossible
  const entry = listBackups().find((b) => b.name === file);
  const dir = backupDir();
  if (!entry || !dir) return new NextResponse("Not found", { status: 404 });

  // streamed, not buffered — snapshots grow with the business
  const body = Readable.toWeb(createReadStream(join(dir, entry.name))) as unknown as ReadableStream;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(entry.bytes),
      "Content-Disposition": `attachment; filename="${entry.name}"`,
      "Cache-Control": "no-store",
    },
  });
}
