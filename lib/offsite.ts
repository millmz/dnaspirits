import { createHash, createHmac } from "crypto";
import { readFileSync, existsSync, writeFileSync, statfsSync, rmSync } from "fs";
import { join } from "path";
import { db } from "./db";
import { backupDatabase, backupDir } from "./backup";
import { mediaDir, mediaFilePath } from "./media";

/**
 * Offsite backups to any S3-compatible bucket (AWS S3, Cloudflare R2,
 * Backblaze B2). The local disk holds the live DB, its snapshots AND the
 * media files — one disk failure would take all of them, so a nightly copy
 * goes offsite. Implemented with plain fetch + AWS SigV4 (no SDK).
 *
 * Env (Render → Environment):
 *   OFFSITE_S3_ENDPOINT           e.g. https://<account>.r2.cloudflarestorage.com
 *   OFFSITE_S3_BUCKET             bucket name
 *   OFFSITE_S3_ACCESS_KEY_ID
 *   OFFSITE_S3_SECRET_ACCESS_KEY
 *   OFFSITE_S3_REGION             optional (default "auto"; use "us-east-1" for AWS)
 *
 * Retention of old offsite snapshots is left to a bucket lifecycle rule.
 */

export function offsiteConfigured(): boolean {
  return Boolean(
    process.env.OFFSITE_S3_ENDPOINT &&
      process.env.OFFSITE_S3_BUCKET &&
      process.env.OFFSITE_S3_ACCESS_KEY_ID &&
      process.env.OFFSITE_S3_SECRET_ACCESS_KEY
  );
}

const sha256hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** Signed S3 request (SigV4, path-style). */
async function s3Request(
  method: "PUT" | "HEAD" | "GET" | "DELETE",
  key: string,
  body?: Buffer,
  range?: string
): Promise<Response> {
  const endpoint = process.env.OFFSITE_S3_ENDPOINT!.replace(/\/$/, "");
  const bucket = process.env.OFFSITE_S3_BUCKET!;
  const accessKey = process.env.OFFSITE_S3_ACCESS_KEY_ID!;
  const secretKey = process.env.OFFSITE_S3_SECRET_ACCESS_KEY!;
  const region = process.env.OFFSITE_S3_REGION || "auto";

  const url = new URL(`${endpoint}/${bucket}/${key}`);
  const host = url.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body ?? "");

  const canonicalUri = url.pathname
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  // range participates in signing when present (headers must be sorted)
  const canonicalHeaders = range
    ? `host:${host}\nrange:${range}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    : `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = range ? "host;range;x-amz-content-sha256;x-amz-date" : "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return fetch(url.toString(), {
    method,
    headers: {
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ...(body ? { "Content-Length": String(body.length) } : {}),
      ...(range ? { Range: range } : {}),
    },
    body: body as BodyInit | undefined,
    signal: AbortSignal.timeout(120_000),
  });
}

/** Fetch an object (optionally a byte range) — used to serve R2-held media. */
export async function fetchObject(key: string, range?: string): Promise<Response> {
  return s3Request("GET", key, undefined, range);
}

export async function deleteObject(key: string): Promise<void> {
  await s3Request("DELETE", key).catch(() => undefined); // best-effort
}

/** Upload a media file's bytes under its stable media/ key. */
export async function uploadMediaObject(key: string, body: Buffer): Promise<void> {
  await upload(key, body);
}

async function objectExists(key: string): Promise<boolean> {
  const res = await s3Request("HEAD", key);
  return res.ok;
}

async function upload(key: string, body: Buffer): Promise<void> {
  const res = await s3Request("PUT", key, body);
  if (!res.ok) throw new Error(`Upload of ${key} failed: HTTP ${res.status}`);
}

export type OffsiteStatus = {
  at: string;
  snapshot: string;
  mediaUploaded: number;
  mediaSkipped: number;
  errors: string[];
};

const statusPath = () => join(backupDir() ?? ".", "offsite-status.json");

export function lastOffsiteStatus(): OffsiteStatus | null {
  try {
    const p = statusPath();
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as OffsiteStatus;
  } catch {
    return null;
  }
}

/**
 * Nightly offsite run: take a fresh snapshot and upload it, then upload any
 * media files the bucket doesn't have yet (media files are immutable, so a
 * HEAD check per file is enough).
 */
export async function runOffsiteBackup(): Promise<OffsiteStatus> {
  const errors: string[] = [];
  let snapshotKey = "";
  let mediaUploaded = 0;
  let mediaSkipped = 0;

  try {
    const snapshot = await backupDatabase();
    if (snapshot) {
      const name = snapshot.split("/").pop()!;
      snapshotKey = `backups/${name}`;
      await upload(snapshotKey, readFileSync(snapshot));
    }
  } catch (e) {
    errors.push(`snapshot: ${e instanceof Error ? e.message : "failed"}`);
  }

  try {
    const assets = await db.mediaAsset.findMany();
    for (const asset of assets) {
      const local = mediaFilePath(asset);
      if (!existsSync(local)) continue;
      const key = `media/${local.split("/").pop()}`;
      try {
        if (!(await objectExists(key))) {
          await upload(key, readFileSync(local));
          mediaUploaded++;
        } else {
          mediaSkipped++;
        }
        // bytes are safely in the bucket — serve from there and free the disk
        await db.mediaAsset.update({ where: { id: asset.id }, data: { storage: "r2" } });
        rmSync(local, { force: true });
      } catch (e) {
        errors.push(`${key}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
  } catch (e) {
    errors.push(`media scan: ${e instanceof Error ? e.message : "failed"}`);
  }

  const status: OffsiteStatus = {
    at: new Date().toISOString(),
    snapshot: snapshotKey,
    mediaUploaded,
    mediaSkipped,
    errors,
  };
  try {
    writeFileSync(statusPath(), JSON.stringify(status, null, 2));
  } catch {
    // status file is best-effort
  }
  return status;
}

/** Disk usage for the data volume (DB + backups + media live together). */
export function diskUsage(): { totalBytes: number; freeBytes: number; usedPct: number } | null {
  try {
    const dir = backupDir() ?? mediaDir();
    const s = statfsSync(dir);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { totalBytes: total, freeBytes: free, usedPct: total > 0 ? Math.round(((total - free) / total) * 100) : 0 };
  } catch {
    return null;
  }
}
