"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toDate } from "@/lib/format";

export async function createLegalRecord(formData: FormData) {
  await requireAdmin();
  const executedRaw = String(formData.get("executed") ?? "").trim();
  const dueRaw = String(formData.get("dueDate") ?? "").trim();
  await db.legalRecord.create({
    data: {
      type: String(formData.get("type") ?? "DOCUMENT"),
      title: String(formData.get("title") ?? "").trim(),
      reference: String(formData.get("reference") ?? "").trim(),
      jurisdiction: String(formData.get("jurisdiction") ?? "").trim(),
      executed: executedRaw ? toDate(executedRaw) : null,
      dueDate: dueRaw ? toDate(dueRaw) : null,
      link: String(formData.get("link") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/legal");
}

export async function setLegalStatus(formData: FormData) {
  await requireAdmin();
  await db.legalRecord.update({
    where: { id: String(formData.get("id")) },
    data: { status: String(formData.get("status") ?? "ACTIVE") },
  });
  revalidatePath("/legal");
}

export async function deleteLegalRecord(formData: FormData) {
  await requireAdmin();
  await db.legalRecord.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/legal");
}
