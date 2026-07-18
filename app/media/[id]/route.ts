import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { db } from "@/lib/db";
import { openMediaStream, mediaObjectKey } from "@/lib/media";

/**
 * Public media serving for post images/videos. Deliberately unauthenticated:
 * Meta downloads the file from this URL when publishing to Instagram/Facebook.
 * The id is an unguessable cuid, and only post media lives here — nothing
 * sensitive. Range requests are supported (Meta's video fetcher uses them).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const asset = await db.mediaAsset.findUnique({ where: { id: id.split(".")[0] } });
  if (!asset) return new NextResponse("Not found", { status: 404 });

  const range = req.headers.get("range");
  let start: number | undefined;
  let end: number | undefined;
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    start = m[1] ? parseInt(m[1], 10) : undefined;
    end = m[2] ? parseInt(m[2], 10) : undefined;
  }

  // R2-held media: proxy from the bucket, passing the Range through
  if (asset.storage === "r2") {
    const { fetchObject } = await import("@/lib/offsite");
    const r2 = await fetchObject(mediaObjectKey(asset), range ?? undefined);
    if (!r2.ok && r2.status !== 206) return new NextResponse("Not found", { status: 404 });
    const headers = new Headers({
      "Content-Type": asset.mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Disposition": "inline",
    });
    for (const h of ["content-length", "content-range"]) {
      const v = r2.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new NextResponse(r2.body, { status: r2.status === 206 ? 206 : 200, headers });
  }

  const opened = openMediaStream(asset, start, end);
  if (!opened) return new NextResponse("Not found", { status: 404 });

  const isPartial = Boolean(m && (m[1] || m[2]));
  const headers = new Headers({
    "Content-Type": asset.mime,
    "Content-Length": String(opened.end - opened.start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400, immutable",
    "Content-Disposition": "inline",
  });
  if (isPartial) {
    headers.set("Content-Range", `bytes ${opened.start}-${opened.end}/${opened.size}`);
  }

  const body = Readable.toWeb(opened.stream) as unknown as ReadableStream;
  return new NextResponse(body, { status: isPartial ? 206 : 200, headers });
}
