"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { stageDocument, approvePending } from "@/lib/ingest";

/** Upload a document for staged review — parses & analyzes, but does not commit. */
export async function uploadForReview(formData: FormData) {
  await requireOps();
  const file = formData.get("file") as File | null;
  const importerId = String(formData.get("importerId") ?? "").trim() || null;
  if (!file || file.size === 0) redirect("/inbox?err=No+file+selected");

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const { kind } = await stageDocument(buf, file.name, importerId);
    revalidatePath("/inbox");
    redirect(`/inbox?staged=${kind}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // let redirect() bubble
    console.error("stage failed:", e);
    redirect("/inbox?err=Could+not+read+that+document");
  }
}

export async function approveImport(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  try {
    await approvePending(id);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // let redirect() bubble
    console.error("approve failed:", e);
    const why = e instanceof Error ? e.message : "Import failed on approval";
    redirect(`/inbox?err=${encodeURIComponent(why)}`);
  }
  revalidatePath("/inbox");
  revalidatePath("/depletions");
  revalidatePath("/channel");
  revalidatePath("/position");
  revalidatePath("/accounting");
  revalidatePath("/reports");
  revalidatePath("/");
  redirect("/inbox?approved=1");
}

export async function rejectImport(formData: FormData) {
  await requireOps();
  await db.pendingImport.update({
    where: { id: String(formData.get("id")) },
    data: { status: "REJECTED", reviewedAt: new Date() },
  });
  revalidatePath("/inbox");
}

export async function deletePending(formData: FormData) {
  await requireOps();
  await db.pendingImport.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/inbox");
}
