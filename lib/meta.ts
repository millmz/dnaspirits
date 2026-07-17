import { db } from "./db";
import { isVideo } from "./media";

/**
 * Meta (Instagram + Facebook) publishing and analytics via the Graph API.
 *
 * Env (Render → Environment):
 *   META_ACCESS_TOKEN  — long-lived Page access token from your Meta app
 *   META_IG_USER_ID    — the Instagram professional account's IG User id
 *   META_FB_PAGE_ID    — the Facebook Page id
 *   APP_URL            — public base URL (e.g. https://ops.denadatequila.com)
 *                        so Meta can download uploaded media
 *
 * Publishing is done by a background worker tick (see instrumentation.ts):
 * a post with autoPublish on, status SCHEDULED and date <= now is published
 * to its channel. A post with ONE media item publishes as a normal IG post
 * (videos as Reels); 2–10 items publish as an IG carousel (the "swipe" post)
 * or a Facebook multi-photo post. Instagram processes containers
 * asynchronously, so the worker carries state across ticks:
 *   igChildIds   — carousel item containers waiting to finish processing
 *   igCreationId — the final container (single video / reel / carousel)
 * Failures set publishError and turn autoPublish off so a broken post never
 * retries in a loop — fix, then hit Retry.
 */

const GRAPH = () => process.env.META_GRAPH_URL || "https://graph.facebook.com/v23.0";
const MAX_CAROUSEL = 10;

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

type MediaItem = { id: string; mime: string; position: number };

type PostForPublish = {
  id: string;
  channel: string;
  caption: string;
  hashtags: string;
  igChildIds: string;
  igCreationId: string;
  fbPostId: string;
  items: MediaItem[];
  assetUrl: string;
};

function fullCaption(p: { caption: string; hashtags: string }): string {
  return [p.caption, p.hashtags].filter(Boolean).join("\n\n");
}

function itemUrl(item: MediaItem): string {
  return `${appBaseUrl()}/media/${item.id}`;
}

/** Ordered media descriptors: uploaded items, falling back to assetUrl. */
function mediaList(p: PostForPublish): { url: string; video: boolean }[] {
  const items = [...p.items].sort((a, b) => a.position - b.position);
  if (items.length > 0) {
    if (!appBaseUrl()) throw new Error("Set APP_URL so Meta can download uploaded media.");
    return items.map((i) => ({ url: itemUrl(i), video: isVideo(i.mime) }));
  }
  if (p.assetUrl) return [{ url: p.assetUrl, video: /\.(mp4|mov)(\?|$)/i.test(p.assetUrl) }];
  return [];
}

async function containerStatus(id: string): Promise<string> {
  const status = await graph(`/${id}`, { fields: "status_code" });
  return String(status.status_code ?? "");
}

async function markPosted(postId: string, data: Record<string, unknown>) {
  await db.socialPost.update({
    where: { id: postId },
    data: { ...data, status: "POSTED", publishedAt: new Date() },
  });
}

/**
 * Advance one post's publish by one step. Returns true when fully published,
 * false when Instagram is still processing (the next tick continues).
 * Throws with a human-readable message on failure.
 */
export async function publishStep(p: PostForPublish): Promise<boolean> {
  if (p.channel === "INSTAGRAM") return publishInstagram(p);
  if (p.channel === "FACEBOOK") return publishFacebook(p);
  if (p.channel === "IG_FB") {
    // Cross-post: Facebook first (one synchronous call), then the async
    // Instagram flow. POSTED only lands when Instagram finishes — and a
    // retry after an IG failure skips the already-published FB half.
    if (!igConfigured() || !fbConfigured()) {
      throw new Error("Posting to both platforms needs Instagram AND Facebook connected.");
    }
    if (!p.fbPostId) {
      const fbId = await publishFacebookRaw(p);
      await db.socialPost.update({ where: { id: p.id }, data: { fbPostId: fbId } });
      p = { ...p, fbPostId: fbId };
    }
    return publishInstagram(p);
  }
  throw new Error(`Auto-publish supports Instagram and Facebook, not ${p.channel}.`);
}

async function publishInstagram(p: PostForPublish): Promise<boolean> {
  if (!igConfigured()) throw new Error("Instagram is not connected (set META_ACCESS_TOKEN and META_IG_USER_ID).");
  const ig = process.env.META_IG_USER_ID!;

  // Final container exists (single video/reel or assembled carousel) — poll, publish.
  if (p.igCreationId) {
    const code = await containerStatus(p.igCreationId);
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(`Instagram could not process the media (status ${code}). Check the file format.`);
    }
    if (code !== "FINISHED") return false; // still processing — next tick
    const pub = await graph(`/${ig}/media_publish`, { creation_id: p.igCreationId }, "POST");
    await markPosted(p.id, { igMediaId: String(pub.id ?? ""), igCreationId: "", igChildIds: "" });
    return true;
  }

  // Carousel children pending — wait for all to finish, then assemble.
  if (p.igChildIds) {
    const children = p.igChildIds.split(",").filter(Boolean);
    for (const child of children) {
      const code = await containerStatus(child);
      if (code === "ERROR" || code === "EXPIRED") {
        throw new Error(`Instagram could not process one of the carousel items (status ${code}).`);
      }
      if (code !== "FINISHED") return false; // some item still processing
    }
    const carousel = await graph(
      `/${ig}/media`,
      { media_type: "CAROUSEL", children: children.join(","), caption: fullCaption(p) },
      "POST"
    );
    const creationId = String(carousel.id ?? "");
    if (!creationId) throw new Error("Instagram did not return a carousel container id.");
    await db.socialPost.update({
      where: { id: p.id },
      data: { igCreationId: creationId, igChildIds: "" },
    });
    // publish immediately if the assembled carousel is already done
    return publishInstagram({ ...p, igCreationId: creationId, igChildIds: "" });
  }

  // Fresh post — create container(s).
  const media = mediaList(p);
  if (media.length === 0) throw new Error("Instagram needs at least one image or video — upload media first.");
  if (media.length > MAX_CAROUSEL) throw new Error(`Instagram carousels allow at most ${MAX_CAROUSEL} items — this post has ${media.length}.`);

  if (media.length === 1) {
    const [m] = media;
    const params: Record<string, string> = { caption: fullCaption(p) };
    if (m.video) {
      params.media_type = "REELS";
      params.video_url = m.url;
    } else {
      params.image_url = m.url;
    }
    const container = await graph(`/${ig}/media`, params, "POST");
    const creationId = String(container.id ?? "");
    if (!creationId) throw new Error("Instagram did not return a media container id.");
    if (m.video) {
      await db.socialPost.update({ where: { id: p.id }, data: { igCreationId: creationId } });
      return false; // async processing — publish on a later tick
    }
    const pub = await graph(`/${ig}/media_publish`, { creation_id: creationId }, "POST");
    await markPosted(p.id, { igMediaId: String(pub.id ?? "") });
    return true;
  }

  // Carousel: one child container per item, in swipe order.
  const childIds: string[] = [];
  for (const m of media) {
    const params: Record<string, string> = { is_carousel_item: "true" };
    if (m.video) {
      params.media_type = "VIDEO";
      params.video_url = m.url;
    } else {
      params.image_url = m.url;
    }
    const child = await graph(`/${ig}/media`, params, "POST");
    const childId = String(child.id ?? "");
    if (!childId) throw new Error("Instagram did not return a carousel item container id.");
    childIds.push(childId);
  }
  await db.socialPost.update({ where: { id: p.id }, data: { igChildIds: childIds.join(",") } });
  // image-only carousels are usually ready instantly — try to finish this tick
  return publishInstagram({ ...p, igChildIds: childIds.join(","), igCreationId: "" });
}

/** Publish to the Facebook Page and return the post id (no status change). */
async function publishFacebookRaw(p: PostForPublish): Promise<string> {
  if (!fbConfigured()) throw new Error("Facebook is not connected (set META_ACCESS_TOKEN and META_FB_PAGE_ID).");
  const page = process.env.META_FB_PAGE_ID!;
  const message = fullCaption(p);
  const media = mediaList(p);

  let result: Record<string, unknown>;
  if (media.length === 0) {
    if (!message) throw new Error("A Facebook post needs a caption or media.");
    result = await graph(`/${page}/feed`, { message }, "POST");
  } else if (media.length === 1) {
    const [m] = media;
    result = m.video
      ? await graph(`/${page}/videos`, { file_url: m.url, description: message }, "POST")
      : await graph(`/${page}/photos`, { url: m.url, message }, "POST");
  } else {
    if (media.some((m) => m.video)) {
      throw new Error("Facebook multi-media posts support photos only — post the video on its own.");
    }
    // upload each photo unpublished, then attach them all to one feed post
    const photoIds: string[] = [];
    for (const m of media) {
      const photo = await graph(`/${page}/photos`, { url: m.url, published: "false" }, "POST");
      const photoId = String(photo.id ?? "");
      if (!photoId) throw new Error("Facebook did not return a photo id.");
      photoIds.push(photoId);
    }
    const params: Record<string, string> = { message };
    photoIds.forEach((id, i) => {
      params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    });
    result = await graph(`/${page}/feed`, params, "POST");
  }

  return String(result.post_id ?? result.id ?? "");
}

async function publishFacebook(p: PostForPublish): Promise<boolean> {
  const fbId = await publishFacebookRaw(p);
  await markPosted(p.id, { fbPostId: fbId });
  return true;
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
      channel: { in: ["INSTAGRAM", "FACEBOOK", "IG_FB"] },
    },
    include: { items: true },
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
        data: { publishError: msg.slice(0, 500), autoPublish: false, igCreationId: "", igChildIds: "" },
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
