"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toCents, toDate } from "@/lib/format";

export async function createCampaign(formData: FormData) {
  await requireUser();
  const endRaw = String(formData.get("endDate") ?? "").trim();
  await db.campaign.create({
    data: {
      name: String(formData.get("name") ?? "").trim(),
      market: String(formData.get("market") ?? "").trim(),
      budgetCents: toCents(formData.get("budget") as string),
      startDate: toDate(formData.get("startDate") as string),
      endDate: endRaw ? toDate(endRaw) : null,
      status: String(formData.get("status") ?? "ACTIVE"),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/marketing");
}

export async function createActivity(formData: FormData) {
  await requireUser();
  const campaignId = String(formData.get("campaignId") ?? "");
  await db.marketingActivity.create({
    data: {
      campaignId: campaignId || null,
      date: toDate(formData.get("date") as string),
      type: String(formData.get("type") ?? "EVENT"),
      name: String(formData.get("name") ?? "").trim(),
      market: String(formData.get("market") ?? "").trim(),
      costCents: toCents(formData.get("cost") as string),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/marketing");
}

export async function setCampaignStatus(formData: FormData) {
  await requireUser();
  await db.campaign.update({
    where: { id: String(formData.get("id")) },
    data: { status: String(formData.get("status")) },
  });
  revalidatePath("/marketing");
}
