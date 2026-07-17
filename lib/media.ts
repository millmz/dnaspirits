import { mkdirSync, existsSync, rmSync, createReadStream, statSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname, isAbsolute, join } from "path";
import { db } from "./db";

/**
 * Uploaded post media (images/videos), stored on disk next to the database —
 * on Render that's the persistent disk, so files survive deploys. Each asset
 * gets a cuid that doubles as its public URL path (/media/<id>): Meta must be
 * able to download the file when publishing, so the URL is public but
 * unguessable.
 */

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB (IG reels cap is higher, but keep memory sane)

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

function dataDir(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) {
    const raw = url.slice(5);
    const p = isAbsolute(raw) ? raw : join(process.cwd(), "prisma", raw);
    return dirname(p);
  }
  return join(process.cwd(), "prisma");
}

export function mediaDir(): string {
  return join(dataDir(), "media");
}

export const isImage = (mime: string) => IMAGE_MIMES.has(mime);
export const isVideo = (mime: string) => VIDEO_MIMES.has(mime);

export function mediaFilePath(asset: { id: string; mime: string }): string {
  return join(mediaDir(), `${asset.id}.${EXT[asset.mime] ?? "bin"}`);
}

export async function saveMedia(
  file: File
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const mime = file.type;
  if (!IMAGE_MIMES.has(mime) && !VIDEO_MIMES.has(mime)) {
    return { ok: false, error: `Unsupported file type ${mime || "unknown"} — use JPG, PNG, GIF, WebP, MP4 or MOV.` };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File is over the 200 MB limit." };
  }
  const asset = await db.mediaAsset.create({
    data: { filename: file.name, mime, bytes: file.size },
  });
  mkdirSync(mediaDir(), { recursive: true });
  await writeFile(mediaFilePath(asset), Buffer.from(await file.arrayBuffer()));
  return { ok: true, id: asset.id };
}

/** Delete an asset (row + file) if no post still references it. */
export async function deleteMediaIfOrphaned(id: string | null | undefined) {
  if (!id) return;
  const used = await db.socialPost.count({ where: { mediaId: id } });
  if (used > 0) return;
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset) return;
  rmSync(mediaFilePath(asset), { force: true });
  await db.mediaAsset.delete({ where: { id } });
}

/** Open a read stream for the range (for the public serve route). */
export function openMediaStream(asset: { id: string; mime: string }, start?: number, end?: number) {
  const path = mediaFilePath(asset);
  if (!existsSync(path)) return null;
  const size = statSync(path).size;
  const s = start ?? 0;
  const e = end === undefined || end >= size ? size - 1 : end;
  return { stream: createReadStream(path, { start: s, end: e }), size, start: s, end: e };
}
