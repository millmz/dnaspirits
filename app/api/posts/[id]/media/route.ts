import { appendFileSync, renameSync, rmSync, statSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { db } from "@/lib/db";
import { apiOpsUser } from "@/lib/api-auth";
import { mediaRejectReason, mediaFilePath, uploadTmpDir, MAX_MEDIA_BYTES } from "@/lib/media";

const MAX_ITEMS = 10; // IG carousel limit
const MAX_CHUNK = 8 * 1024 * 1024; // client sends 6MB; allow headroom

/**
 * Chunked media upload: the client slices a file into small pieces and sends
 * them sequentially (?offset=N). Small requests survive any proxy/CDN body
 * limit, give real progress, and fail with readable JSON instead of a white
 * screen. When the last chunk lands the file is validated, registered and
 * moved into the media dir under its asset id.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  const { id: postId } = await params;

  const err = (status: number, error: string) => Response.json({ ok: false, error }, { status });

  const url = new URL(req.url);
  const q = (k: string) => url.searchParams.get(k) ?? "";
  const uploadId = q("uploadId");
  const filename = q("filename").slice(0, 200) || "upload";
  const mime = q("mime");
  const total = Number(q("total"));
  const offset = Number(q("offset"));

  if (!/^[a-z0-9-]{8,64}$/i.test(uploadId)) return err(400, "Bad upload id.");
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(offset) || offset < 0) {
    return err(400, "Bad chunk parameters.");
  }
  const reason = mediaRejectReason(mime, total);
  if (reason) return err(400, `${filename}: ${reason}`);

  const post = await db.socialPost.findUnique({ where: { id: postId }, include: { items: true } });
  if (!post) return err(404, "That post no longer exists.");
  if (post.status === "POSTED") return err(400, "This post is already published — media is locked.");
  if (post.items.length >= MAX_ITEMS) return err(400, `Instagram allows up to ${MAX_ITEMS} items per post.`);

  let chunk: Buffer;
  try {
    chunk = Buffer.from(await req.arrayBuffer());
  } catch {
    return err(400, "Could not read the uploaded data.");
  }
  if (chunk.length === 0) return err(400, "Empty chunk.");
  if (chunk.length > MAX_CHUNK) return err(400, "Chunk too large.");
  if (offset + chunk.length > Math.min(total, MAX_MEDIA_BYTES)) return err(400, "Upload exceeds its declared size.");

  const part = join(uploadTmpDir(), `${uploadId}.part`);
  try {
    const have = existsSync(part) ? statSync(part).size : 0;
    if (offset === 0) {
      writeFileSync(part, chunk); // (re)start cleanly, e.g. on retry
    } else if (have !== offset) {
      return err(409, "Upload got out of sync — retry this file.");
    } else {
      appendFileSync(part, chunk);
    }

    const size = statSync(part).size;
    if (size < total) return Response.json({ ok: true, received: size });

    // last chunk landed — register and move into place
    const asset = await db.mediaAsset.create({
      data: { filename, mime, bytes: size, postId, position: post.items.length },
    });
    renameSync(part, mediaFilePath(asset));
    return Response.json({ ok: true, done: true, assetId: asset.id });
  } catch (e) {
    rmSync(part, { force: true });
    console.error("api media upload failed:", e);
    const msg = e instanceof Error ? e.message : "Upload failed.";
    return err(500, msg.includes("ENOSPC") ? "The server disk is full — tell your admin." : msg);
  }
}
