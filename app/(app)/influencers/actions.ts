"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toInt } from "@/lib/format";

export async function createPartner(formData: FormData) {
  await requireOps();
  await db.partner.create({
    data: {
      type: String(formData.get("type") ?? "INFLUENCER"),
      name: String(formData.get("name") ?? "").trim(),
      handle: String(formData.get("handle") ?? "").trim(),
      platform: String(formData.get("platform") ?? "").trim(),
      market: String(formData.get("market") ?? "").trim(),
      followers: toInt(formData.get("followers") as string),
      status: String(formData.get("status") ?? "PROSPECT"),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/influencers");
}

export async function updatePartnerStatus(formData: FormData) {
  await requireOps();
  await db.partner.update({
    where: { id: String(formData.get("id")) },
    data: {
      status: String(formData.get("status")),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/influencers");
}

export async function deletePartner(formData: FormData) {
  await requireOps();
  await db.partner.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/influencers");
}
