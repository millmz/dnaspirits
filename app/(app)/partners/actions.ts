"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";

export async function updateImporter(formData: FormData) {
  await requireOps();
  await db.importer.update({
    where: { id: String(formData.get("id")) },
    data: {
      name: String(formData.get("name") ?? "").trim(),
      country: String(formData.get("country") ?? "").trim(),
      contactName: String(formData.get("contactName") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/partners");
}

export async function createImporter(formData: FormData) {
  await requireOps();
  await db.importer.create({
    data: {
      name: String(formData.get("name") ?? "").trim(),
      country: String(formData.get("country") ?? "USA").trim(),
      contactName: String(formData.get("contactName") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
    },
  });
  revalidatePath("/partners");
}

export async function createDistributor(formData: FormData) {
  await requireOps();
  await db.distributor.create({
    data: {
      importerId: String(formData.get("importerId")),
      name: String(formData.get("name") ?? "").trim(),
      market: String(formData.get("market") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/partners");
}
