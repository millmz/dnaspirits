import { NextResponse } from "next/server";
import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { stageDocument } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Drag-and-drop upload target. Accepts one file per request, stages it in the
 * Review Inbox (classify → parse → flag anomalies) — nothing touches live data
 * until it's approved there.
 */
export async function POST(req: Request) {
  try {
    await requireOps();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Bad upload" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file received" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "File is over 25 MB" }, { status: 413 });
  }

  // Importer: explicit from the page, else the sole importer on file (the
  // normal case — LSI), else none (fine for P&Ls and AI-extracted docs).
  let importerId = String(form.get("importerId") ?? "").trim() || null;
  if (!importerId) {
    const importers = await db.importer.findMany({ take: 2 });
    if (importers.length === 1) importerId = importers[0].id;
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const { id, kind } = await stageDocument(buf, file.name, importerId);
    return NextResponse.json({ id, kind });
  } catch (e) {
    console.error("ingest upload failed:", e);
    return NextResponse.json({ error: "Could not read that document" }, { status: 422 });
  }
}
