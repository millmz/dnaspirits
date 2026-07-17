"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toDate } from "@/lib/format";
import { saveMedia, deleteMediaIfOrphaned } from "@/lib/media";
import { runPublisherTick, runMetricsRefresh, metaConfigured } from "@/lib/meta";

export async function createPost(formData: FormData) {
  await requireOps();

  let mediaId: string | null = null;
  const file = formData.get("media");
  if (file instanceof File && file.size > 0) {
    const saved = await saveMedia(file);
    if (!saved.ok) redirect(`/content?err=${encodeURIComponent(saved.error)}`);
    mediaId = saved.id;
  }

  await db.socialPost.create({
    data: {
      date: toDate(formData.get("date") as string),
      channel: String(formData.get("channel") ?? "INSTAGRAM"),
      title: String(formData.get("title") ?? "").trim(),
      caption: String(formData.get("caption") ?? "").trim(),
      hashtags: String(formData.get("hashtags") ?? "").trim(),
      assetUrl: String(formData.get("assetUrl") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
      status: String(formData.get("status") ?? "IDEA"),
      mediaId,
      autoPublish: formData.get("autoPublish") === "on",
    },
  });
  revalidatePath("/content");
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
  await db.socialPost.delete({ where: { id } });
  await deleteMediaIfOrphaned(post.mediaId);
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

export async function refreshMetrics() {
  await requireOps();
  if (!metaConfigured()) redirect("/content/analytics?err=Meta%20is%20not%20connected");
  const r = await runMetricsRefresh();
  const err = r.errors.length ? `&err=${encodeURIComponent(r.errors[0])}` : "";
  redirect(`/content/analytics?updated=${r.updated}${err}`);
}
