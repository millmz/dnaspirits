"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toDate } from "@/lib/format";
import { deleteAsset, deletePostMediaFiles, renumberPostMedia } from "@/lib/media";
import { runPublisherTick, runMetricsRefresh, metaConfigured, importLiveFeed } from "@/lib/meta";
import { guardAction } from "@/lib/action-guard";

// Post creation and media uploads live in /api/posts (JSON + chunked
// uploads) so files never ride a giant all-or-nothing form post.

export async function removePostMedia(formData: FormData) {
  await requireOps();
  const assetId = String(formData.get("assetId"));
  const asset = await db.mediaAsset.findUnique({ where: { id: assetId }, include: { post: true } });
  if (!asset || asset.post?.status === "POSTED") return;
  await deleteAsset(assetId);
  revalidatePath("/content");
}

/** Move a carousel item one step left (-1) or right (+1) in swipe order. */
export async function movePostMedia(formData: FormData) {
  await requireOps();
  const assetId = String(formData.get("assetId"));
  const dir = formData.get("dir") === "left" ? -1 : 1;
  const asset = await db.mediaAsset.findUnique({ where: { id: assetId }, include: { post: true } });
  if (!asset?.postId || asset.post?.status === "POSTED") return;

  await renumberPostMedia(asset.postId);
  const items = await db.mediaAsset.findMany({ where: { postId: asset.postId }, orderBy: { position: "asc" } });
  const idx = items.findIndex((i) => i.id === assetId);
  const swap = idx + dir;
  if (idx < 0 || swap < 0 || swap >= items.length) return;
  await db.mediaAsset.update({ where: { id: items[idx].id }, data: { position: swap } });
  await db.mediaAsset.update({ where: { id: items[swap].id }, data: { position: idx } });
  revalidatePath("/content");
}

/** Edit a post's copy/schedule (anything except published posts). */
export async function editPost(formData: FormData) {
  await requireOps();
  await guardAction("/content", "save the changes", async () => {
    const id = String(formData.get("id"));
    const post = await db.socialPost.findUnique({ where: { id } });
    if (!post || post.status === "POSTED") redirect("/content?err=Published+posts+can%27t+be+edited");
    const title = String(formData.get("title") ?? "").trim();
    if (!title) redirect(`/content?err=Title+can%27t+be+empty`);
    await db.socialPost.update({
      where: { id },
      data: {
        title,
        date: toDate(formData.get("datetime") as string),
        channel: String(formData.get("channel") ?? "INSTAGRAM"),
        caption: String(formData.get("caption") ?? "").trim(),
        hashtags: String(formData.get("hashtags") ?? "").trim(),
        assetUrl: String(formData.get("assetUrl") ?? "").trim(),
        notes: String(formData.get("notes") ?? "").trim(),
        autoPublish: formData.get("autoPublish") === "on",
        publishError: "", // edits usually fix the cause — re-arm cleanly
      },
    });
    revalidatePath("/content");
    redirect("/content");
  });
}

export async function advancePost(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const post = await db.socialPost.findUnique({ where: { id } });
  if (!post) return;
  const flow = ["IDEA", "DRAFTED", "SCHEDULED", "POSTED"];
  const next = flow[Math.min(flow.indexOf(post.status) + 1, flow.length - 1)];
  await db.socialPost.update({ where: { id }, data: { status: next } });
  revalidatePath("/content");
}

export async function deletePost(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const post = await db.socialPost.findUnique({ where: { id } });
  if (!post) return;
  await deletePostMediaFiles(id); // files first; rows cascade with the post
  await db.socialPost.delete({ where: { id } });
  revalidatePath("/content");
}

/**
 * Publish to Instagram/Facebook right now: pull the date to the present,
 * arm auto-publish and run a worker tick immediately. Videos keep
 * processing in the background and go live within a minute or two.
 */
export async function publishNow(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const post = await db.socialPost.findUnique({ where: { id } });
  if (!post || post.status === "POSTED") return;
  await db.socialPost.update({
    where: { id },
    data: {
      status: "SCHEDULED",
      autoPublish: true,
      publishError: "",
      date: post.date > new Date() ? new Date() : post.date,
    },
  });
  await runPublisherTick();
  revalidatePath("/content");
}

/** Re-arm a post whose publish failed (after fixing the cause). */
export async function retryPublish(formData: FormData) {
  await requireOps();
  await db.socialPost.update({
    where: { id: String(formData.get("id")) },
    data: { publishError: "", autoPublish: true, status: "SCHEDULED" },
  });
  await runPublisherTick();
  revalidatePath("/content");
}

/** Quick idea capture: title only, lands in the backlog (no date). */
export async function createIdea(formData: FormData) {
  await requireOps();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await db.socialPost.create({
    data: { title: title.slice(0, 300), status: "IDEA", unscheduled: true, date: new Date() },
  });
  revalidatePath("/content");
}

/** Put a backlog idea on the calendar. */
export async function scheduleIdea(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const post = await db.socialPost.findUnique({ where: { id } });
  if (!post || !post.unscheduled) return;
  await db.socialPost.update({
    where: { id },
    data: { unscheduled: false, date: toDate(formData.get("datetime") as string) },
  });
  revalidatePath("/content");
}

/** Copy a post's text/settings as a new backlog idea (media not copied). */
export async function duplicatePost(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const post = await db.socialPost.findUnique({ where: { id } });
  if (!post) return;
  await db.socialPost.create({
    data: {
      title: `${post.title} (copy)`.slice(0, 300),
      caption: post.caption,
      hashtags: post.hashtags,
      firstComment: post.firstComment,
      channel: post.channel,
      format: post.format,
      notes: post.notes,
      status: "IDEA",
      unscheduled: true,
      date: new Date(),
    },
  });
  revalidatePath("/content");
}

/** Recurring series management. */
export async function createSeries(formData: FormData) {
  await requireOps();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const dow = Number(formData.get("dayOfWeek"));
  await db.postSeries.create({
    data: {
      name: name.slice(0, 200),
      dayOfWeek: dow >= 0 && dow <= 6 ? dow : 1,
      time: /^\d{2}:\d{2}$/.test(String(formData.get("time"))) ? String(formData.get("time")) : "09:00",
      channel: String(formData.get("channel") ?? "IG_FB"),
      titleTemplate: String(formData.get("titleTemplate") ?? "").trim() || name,
      captionTemplate: String(formData.get("captionTemplate") ?? "").trim(),
      hashtags: String(formData.get("hashtags") ?? "").trim(),
    },
  });
  const { materializeSeries } = await import("@/lib/series");
  await materializeSeries();
  revalidatePath("/content");
}

export async function toggleSeries(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const s = await db.postSeries.findUnique({ where: { id } });
  if (!s) return;
  await db.postSeries.update({ where: { id }, data: { active: !s.active } });
  if (!s.active) {
    const { materializeSeries } = await import("@/lib/series");
    await materializeSeries();
  }
  revalidatePath("/content");
}

export async function deleteSeries(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  // future placeholders that are still untouched ideas go with the series
  await db.socialPost.deleteMany({ where: { seriesId: id, status: "IDEA", date: { gt: new Date() } } });
  await db.postSeries.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/content");
}

/** Pull everything already live on IG/FB onto the calendar. */
export async function syncLiveFeed() {
  await requireOps();
  if (!metaConfigured()) redirect("/content?err=Meta%20is%20not%20connected");
  const r = await importLiveFeed();
  if (r.errors.length) {
    redirect(`/content?err=${encodeURIComponent(`Feed sync: ${r.errors[0]}`)}`);
  }
  revalidatePath("/content");
  redirect(`/content?synced=${r.ig}+${r.fb}`);
}

export async function refreshMetrics() {
  await requireOps();
  if (!metaConfigured()) redirect("/content/analytics?err=Meta%20is%20not%20connected");
  const r = await runMetricsRefresh();
  const err = r.errors.length ? `&err=${encodeURIComponent(r.errors[0])}` : "";
  redirect(`/content/analytics?updated=${r.updated}${err}`);
}
