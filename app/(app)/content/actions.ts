"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireOps, requireAdmin } from "@/lib/auth";
import { toDate } from "@/lib/format";
import { triggerBrandManager, defaultDraftInstruction } from "@/lib/chatgpt-agent";

export async function createPost(formData: FormData) {
  await requireOps();
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
      source: "MANUAL",
      approved: true,
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

/** Approve a post the brand-manager agent proposed — it joins the live calendar. */
export async function approveProposed(formData: FormData) {
  await requireOps();
  await db.socialPost.update({
    where: { id: String(formData.get("id")) },
    data: { approved: true },
  });
  revalidatePath("/content");
}

export async function deletePost(formData: FormData) {
  await requireOps();
  await db.socialPost.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/content");
}

/**
 * Kick off a run of the brand-manager ChatGPT agent, asking it to draft posts.
 * The agent reads/writes the calendar back over MCP; its proposals land in the
 * approval queue. Admin-only — it spends the workspace agent's run budget.
 */
export async function triggerBrandManagerAction(formData: FormData) {
  await requireAdmin();
  const monthParam = String(formData.get("month") ?? "");
  const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : new Date().toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const custom = String(formData.get("instruction") ?? "").trim();
  const input = custom || defaultDraftInstruction(monthLabel);
  const conversationKey = `denada-content-${month}`;

  const result = await triggerBrandManager(input, conversationKey);
  const flash = result.ok
    ? "agent=queued"
    : `agent=error&msg=${encodeURIComponent(result.error)}`;
  redirect(`/content?month=${month}&${flash}`);
}
