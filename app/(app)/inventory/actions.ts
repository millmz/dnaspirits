"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toInt, toDate } from "@/lib/format";

/** Manual adjustment: breakage, samples, count corrections. Signed bottle count. */
export async function adjustInventory(formData: FormData) {
  await requireUser();
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

/** Move stock between warehouses: one negative and one positive movement. */
export async function transferInventory(formData: FormData) {
  await requireUser();
  const bottles = Math.abs(toInt(formData.get("bottles") as string));
  const fromId = String(formData.get("fromWarehouseId"));
  const toId = String(formData.get("toWarehouseId"));
  if (bottles === 0 || fromId === toId) return;
  const productId = String(formData.get("productId"));
  const date = toDate(formData.get("date") as string);
  const notes = String(formData.get("notes") ?? "").trim();

  await db.$transaction([
    db.inventoryMovement.create({
      data: { productId, warehouseId: fromId, type: "TRANSFER_OUT", bottles: -bottles, date, notes },
    }),
    db.inventoryMovement.create({
      data: { productId, warehouseId: toId, type: "TRANSFER_IN", bottles, date, notes },
    }),
  ]);
  revalidatePath("/inventory");
  revalidatePath("/");
}
