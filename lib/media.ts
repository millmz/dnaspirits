import { mkdirSync, existsSync, rmSync, createReadStream, statSync, readdirSync } from "fs";
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
export const MAX_MEDIA_BYTES = MAX_BYTES;

/** null when acceptable, else a human-readable reason. */
export function mediaRejectReason(mime: string, bytes: number): string | null {
  if (!IMAGE_MIMES.has(mime) && !VIDEO_MIMES.has(mime)) {
    return `Unsupported file type ${mime || "unknown"} — use JPG, PNG, GIF, WebP, MP4 or MOV.`;
  }
  if (bytes > MAX_BYTES) return "File is over the 200 MB limit.";
  return null;
}

/** Staging area for in-flight chunked uploads (same disk as final media). */
export function uploadTmpDir(): string {
  const dir = join(mediaDir(), "tmp");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove stale .part files from abandoned uploads (older than a day). */
export function cleanupUploadTmp() {
  const dir = uploadTmpDir();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try {
      if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true });
    } catch {
      // file vanished mid-scan — nothing to do
    }
  }
}

export function mediaFilePath(asset: { id: string; mime: string }): string {
  return join(mediaDir(), `${asset.id}.${EXT[asset.mime] ?? "bin"}`);
}

export async function saveMedia(
  file: File,
  postId: string,
  position: number
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const mime = file.type;
  if (!IMAGE_MIMES.has(mime) && !VIDEO_MIMES.has(mime)) {
    return { ok: false, error: `Unsupported file type ${mime || "unknown"} — use JPG, PNG, GIF, WebP, MP4 or MOV.` };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File is over the 200 MB limit." };
  }
  const asset = await db.mediaAsset.create({
    data: { filename: file.name, mime, bytes: file.size, postId, position },
  });
  mkdirSync(mediaDir(), { recursive: true });
  await writeFile(mediaFilePath(asset), Buffer.from(await file.arrayBuffer()));
  return { ok: true, id: asset.id };
}

/** Stable object key in the offsite bucket (same shape the backup pass uses). */
export function mediaObjectKey(asset: { id: string; mime: string }): string {
  return `media/${asset.id}.${EXT[asset.mime] ?? "bin"}`;
}

/**
 * Move a finished upload's bytes to the R2 bucket and free the local disk.
 * Best-effort: on any failure the file simply stays on disk ("disk" storage).
 */
export async function offloadToR2(asset: { id: string; mime: string }): Promise<void> {
  const { offsiteConfigured, uploadMediaObject } = await import("./offsite");
  if (!offsiteConfigured()) return;
  const local = mediaFilePath(asset);
  if (!existsSync(local)) return;
  const { readFileSync } = await import("fs");
  await uploadMediaObject(mediaObjectKey(asset), readFileSync(local));
  await db.mediaAsset.update({ where: { id: asset.id }, data: { storage: "r2" } });
  rmSync(local, { force: true });
}

async function removeAssetBytes(asset: { id: string; mime: string; storage: string }) {
  rmSync(mediaFilePath(asset), { force: true });
  if (asset.storage === "r2") {
    const { offsiteConfigured, deleteObject } = await import("./offsite");
    if (offsiteConfigured()) await deleteObject(mediaObjectKey(asset));
  }
}

/** Delete one asset: bytes (disk or R2) + row, then close the position gap. */
export async function deleteAsset(id: string) {
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset) return;
  await removeAssetBytes(asset);
  await db.mediaAsset.delete({ where: { id } });
  if (asset.postId) await renumberPostMedia(asset.postId);
}

/** Delete every media file belonging to a post (call before deleting the post). */
export async function deletePostMediaFiles(postId: string) {
  const assets = await db.mediaAsset.findMany({ where: { postId } });
  for (const a of assets) await removeAssetBytes(a);
}

/** Re-pack positions to 0..n-1 keeping current order. */
export async function renumberPostMedia(postId: string) {
  const items = await db.mediaAsset.findMany({ where: { postId }, orderBy: { position: "asc" } });
  for (let i = 0; i < items.length; i++) {
    if (items[i].position !== i) {
      await db.mediaAsset.update({ where: { id: items[i].id }, data: { position: i } });
    }
  }
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
