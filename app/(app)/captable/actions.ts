"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toCents, toFloat, toDate } from "@/lib/format";

export async function createCapTableEntry(formData: FormData) {
  await requireAdmin();
  const dateRaw = String(formData.get("dateAcquired") ?? "").trim();
  await db.capTableEntry.create({
    data: {
      member: String(formData.get("member") ?? "").trim(),
      unitType: String(formData.get("unitType") ?? "ECONOMIC"),
      units: toFloat(formData.get("units") as string),
      dateAcquired: dateRaw ? toDate(dateRaw) : null,
      round: String(formData.get("round") ?? "").trim(),
      capitalCents: toCents(formData.get("capital") as string),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/captable");
}

export async function deleteCapTableEntry(formData: FormData) {
  await requireAdmin();
  await db.capTableEntry.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/captable");
}
