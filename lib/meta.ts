import { db } from "./db";
import { isImage, isVideo } from "./media";

/**
 * Meta (Instagram + Facebook) publishing and analytics via the Graph API.
 *
 * Env (Render → Environment):
 *   META_ACCESS_TOKEN  — long-lived Page access token from your Meta app,
 *                        with instagram_basic, instagram_content_publish,
 *                        pages_manage_posts, pages_read_engagement,
 *                        instagram_manage_insights, read_insights
 *   META_IG_USER_ID    — the Instagram professional account's IG User id
 *   META_FB_PAGE_ID    — the Facebook Page id
 *   APP_URL            — public base URL (e.g. https://ops.denadatequila.com)
 *                        so Meta can download uploaded media
 *
 * Publishing is done by a background worker tick (see instrumentation.ts):
 * a post with autoPublish on, status SCHEDULED and date <= now is published
 * to its channel. Instagram videos go through an async container (REELS)
 * that we poll across ticks. Failures set publishError and turn autoPublish
 * off so a broken post never retries in a loop — fix, then re-enable.
 */

const GRAPH = () => process.env.META_GRAPH_URL || "https://graph.facebook.com/v23.0";

export function metaConfigured(): boolean {
  return Boolean(
    process.env.META_ACCESS_TOKEN && (process.env.META_IG_USER_ID || process.env.META_FB_PAGE_ID)
  );
}

export function igConfigured(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_IG_USER_ID);
}

export function fbConfigured(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN && process.env.META_FB_PAGE_ID);
}

export function appBaseUrl(): string {
  const url = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "";
  return url.replace(/\/$/, "");
}

async function graph(
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "GET"
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, access_token: process.env.META_ACCESS_TOKEN ?? "" });
  const url = method === "GET" ? `${GRAPH()}${path}?${qs}` : `${GRAPH()}${path}`;
  const res = await fetch(url, {
    method,
    ...(method === "POST"
      ? { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: qs.toString() }
      : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json?.error as { message?: string } | undefined;
    throw new Error(err?.message || `Meta API returned ${res.status}`);
  }
  return json;
}

type PostForPublish = {
  id: string;
  channel: string;
  caption: string;
  hashtags: string;
  igCreationId: string;
  media: { id: string; mime: string } | null;
  assetUrl: string;
};

function fullCaption(p: { caption: string; hashtags: string }): string {
  return [p.caption, p.hashtags].filter(Boolean).join("\n\n");
}

/** Public URL Meta downloads the media from. */
function mediaUrl(p: PostForPublish): string | null {
  if (p.media) {
    const base = appBaseUrl();
    return base ? `${base}/media/${p.media.id}` : null;
  }
  return p.assetUrl || null;
}

const isVideoPost = (p: PostForPublish) =>
  p.media ? isVideo(p.media.mime) : /\.(mp4|mov)(\?|$)/i.test(p.assetUrl);

/**
 * Advance one post's publish by one step. Returns true when fully published.
 * Throws with a human-readable message on failure.
 */
export async function publishStep(p: PostForPublish): Promise<boolean> {
  const now = new Date();

  if (p.channel === "INSTAGRAM") {
    if (!igConfigured()) throw new Error("Instagram is not connected (set META_ACCESS_TOKEN and META_IG_USER_ID).");
    const ig = process.env.META_IG_USER_ID!;

    // Phase 2: container exists — check processing, then publish.
    if (p.igCreationId) {
      const status = await graph(`/${p.igCreationId}`, { fields: "status_code" });
      const code = String(status.status_code ?? "");
      if (code === "ERROR" || code === "EXPIRED") {
        throw new Error(`Instagram could not process the video (status ${code}). Check the file format.`);
      }
      if (code !== "FINISHED") return false; // still processing — next tick
      const pub = await graph(`/${ig}/media_publish`, { creation_id: p.igCreationId }, "POST");
      await db.socialPost.update({
        where: { id: p.id },
        data: { igMediaId: String(pub.id ?? ""), igCreationId: "", status: "POSTED", publishedAt: now },
      });
      return true;
    }

    // Phase 1: create the container.
    const url = mediaUrl(p);
    if (!url) throw new Error("Instagram needs an image or video — upload media or set APP_URL so Meta can reach it.");
    const params: Record<string, string> = { caption: fullCaption(p) };
    if (isVideoPost(p)) {
      params.media_type = "REELS";
      params.video_url = url;
    } else {
      params.image_url = url;
    }
    const container = await graph(`/${ig}/media`, params, "POST");
    const creationId = String(container.id ?? "");
    if (!creationId) throw new Error("Instagram did not return a media container id.");

    if (isVideoPost(p)) {
      // async processing — publish on a later tick
      await db.socialPost.update({ where: { id: p.id }, data: { igCreationId: creationId } });
      return false;
    }
    const pub = await graph(`/${ig}/media_publish`, { creation_id: creationId }, "POST");
    await db.socialPost.update({
      where: { id: p.id },
      data: { igMediaId: String(pub.id ?? ""), status: "POSTED", publishedAt: now },
    });
    return true;
  }

  if (p.channel === "FACEBOOK") {
    if (!fbConfigured()) throw new Error("Facebook is not connected (set META_ACCESS_TOKEN and META_FB_PAGE_ID).");
    const page = process.env.META_FB_PAGE_ID!;
    const url = mediaUrl(p);
    const message = fullCaption(p);
    let result: Record<string, unknown>;
    if (url && isVideoPost(p)) {
      result = await graph(`/${page}/videos`, { file_url: url, description: message }, "POST");
    } else if (url) {
      result = await graph(`/${page}/photos`, { url, message }, "POST");
    } else {
      if (!message) throw new Error("A Facebook post needs a caption or media.");
      result = await graph(`/${page}/feed`, { message }, "POST");
    }
    const fbId = String(result.post_id ?? result.id ?? "");
    await db.socialPost.update({
      where: { id: p.id },
      data: { fbPostId: fbId, status: "POSTED", publishedAt: now },
    });
    return true;
  }

  throw new Error(`Auto-publish supports Instagram and Facebook, not ${p.channel}.`);
}

/**
 * Worker tick: publish everything due. Called every minute from
 * instrumentation.ts and after "Publish now".
 */
export async function runPublisherTick(): Promise<void> {
  if (!metaConfigured()) return;
  const due = await db.socialPost.findMany({
    where: {
      autoPublish: true,
      status: "SCHEDULED",
      date: { lte: new Date() },
      publishError: "",
      channel: { in: ["INSTAGRAM", "FACEBOOK"] },
    },
    include: { media: true },
    take: 10,
  });
  for (const p of due) {
    try {
      await publishStep(p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Publish failed.";
      // park it: no retry loop; the UI shows the error and a retry button
      await db.socialPost.update({
        where: { id: p.id },
        data: { publishError: msg.slice(0, 500), autoPublish: false, igCreationId: "" },
      });
      console.error(`meta: publish failed for post ${p.id}:`, msg);
    }
  }
}

const toInt = (v: unknown) => (typeof v === "number" ? v : parseInt(String(v ?? "0"), 10) || 0);

function igInsightsMap(json: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of (json.data as Array<Record<string, unknown>> | undefined) ?? []) {
    const values = row.values as Array<{ value?: unknown }> | undefined;
    out[String(row.name)] = toInt(values?.[0]?.value);
  }
  return out;
}

/** Fetch and store a metrics snapshot for one published post. */
export async function snapshotPostMetrics(p: {
  id: string;
  igMediaId: string;
  fbPostId: string;
}): Promise<void> {
  if (p.igMediaId) {
    const json = await graph(`/${p.igMediaId}/insights`, {
      metric: "views,reach,likes,comments,shares,saved",
    });
    const m = igInsightsMap(json);
    await db.postMetric.create({
      data: {
        postId: p.id,
        platform: "INSTAGRAM",
        views: m.views ?? 0,
        reach: m.reach ?? 0,
        likes: m.likes ?? 0,
        comments: m.comments ?? 0,
        shares: m.shares ?? 0,
        saves: m.saved ?? 0,
      },
    });
  }
  if (p.fbPostId) {
    const fields = await graph(`/${p.fbPostId}`, {
      fields: "likes.summary(true),comments.summary(true),shares",
    });
    let views = 0;
    let reach = 0;
    try {
      const ins = await graph(`/${p.fbPostId}/insights`, {
        metric: "post_impressions,post_impressions_unique",
      });
      const m = igInsightsMap(ins);
      views = m.post_impressions ?? 0;
      reach = m.post_impressions_unique ?? 0;
    } catch {
      // page-post impressions metrics are gone on some page types — keep engagement
    }
    const likes = toInt((fields.likes as { summary?: { total_count?: unknown } })?.summary?.total_count);
    const comments = toInt((fields.comments as { summary?: { total_count?: unknown } })?.summary?.total_count);
    const shares = toInt((fields.shares as { count?: unknown })?.count);
    await db.postMetric.create({
      data: { postId: p.id, platform: "FACEBOOK", views, reach, likes, comments, shares, saves: 0 },
    });
  }
}

/** Refresh metrics for all published posts. Returns how many were updated. */
export async function runMetricsRefresh(): Promise<{ updated: number; errors: string[] }> {
  if (!metaConfigured()) return { updated: 0, errors: ["Meta is not connected."] };
  const posts = await db.socialPost.findMany({
    where: { status: "POSTED", OR: [{ igMediaId: { not: "" } }, { fbPostId: { not: "" } }] },
    select: { id: true, title: true, igMediaId: true, fbPostId: true },
    take: 200,
  });
  let updated = 0;
  const errors: string[] = [];
  for (const p of posts) {
    try {
      await snapshotPostMetrics(p);
      updated++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "fetch failed";
      errors.push(`${p.title}: ${msg}`);
    }
  }
  return { updated, errors };
}
