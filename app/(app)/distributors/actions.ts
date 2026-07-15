"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export async function createDistributor(formData: FormData) {
  await requireUser();
  await db.distributor.create({
    data: {
      name: String(formData.get("name") ?? "").trim(),
      market: String(formData.get("market") ?? "").trim(),
      contactName: String(formData.get("contactName") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/distributors");
}

export async function updateDistributor(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  await db.distributor.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? "").trim(),
      market: String(formData.get("market") ?? "").trim(),
      contactName: String(formData.get("contactName") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath(`/distributors/${id}`);
  revalidatePath("/distributors");
}
