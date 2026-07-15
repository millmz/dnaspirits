"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toInt, toDate } from "@/lib/format";

/** Manual adjustment to finished goods: breakage, samples, count corrections. */
export async function adjustInventory(formData: FormData) {
  await requireOps();
  const bottles = toInt(formData.get("bottles") as string);
  if (bottles === 0) return;
  await db.inventoryMovement.create({
    data: {
      productId: String(formData.get("productId")),
      warehouseId: String(formData.get("warehouseId")),
      type: String(formData.get("type") ?? "ADJUSTMENT"),
      bottles,
      date: toDate(formData.get("date") as string),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/inventory");
  revalidatePath("/");
}
