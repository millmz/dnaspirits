"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toDate } from "@/lib/format";

export async function createPost(formData: FormData) {
  await requireOps();
  await db.socialPost.create({
    data: {
      date: toDate(formData.get("date") as string),
      channel: String(formData.get("channel") ?? "INSTAGRAM"),
      title: String(formData.get("title") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
      status: String(formData.get("status") ?? "IDEA"),
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
  await db.socialPost.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/content");
}
