"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toInt, toDate } from "@/lib/format";
import { getStockForWarehouse } from "@/lib/inventory";

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

/**
 * Warehouse transfer (e.g. NOM 1414 in Mexico → Western Carriers in the US):
 * one movement out, one in, same timestamp — the ledger always nets to the
 * same total. Refuses if the source doesn't hold enough bottles.
 */
export async function transferInventory(formData: FormData) {
  await requireOps();
  const productId = String(formData.get("productId"));
  const fromId = String(formData.get("fromWarehouseId"));
  const toId = String(formData.get("toWarehouseId"));
  const bottles = Math.abs(toInt(formData.get("bottles") as string));
  const date = toDate(formData.get("date") as string);
  const notes = String(formData.get("notes") ?? "").trim();

  if (bottles === 0) redirect("/inventory?err=Enter+a+bottle+count+to+transfer");
  if (fromId === toId) redirect("/inventory?err=Pick+two+different+warehouses");

  const [onHand, from, to] = await Promise.all([
    getStockForWarehouse(productId, fromId),
    db.warehouse.findUniqueOrThrow({ where: { id: fromId } }),
    db.warehouse.findUniqueOrThrow({ where: { id: toId } }),
  ]);
  if (onHand < bottles) {
    redirect(
      `/inventory?err=${encodeURIComponent(
        `Only ${onHand} bottles at ${from.name} — cannot transfer ${bottles}.`
      )}`
    );
  }

  await db.$transaction([
    db.inventoryMovement.create({
      data: {
        productId,
        warehouseId: fromId,
        type: "TRANSFER",
        bottles: -bottles,
        date,
        notes: notes || `Transfer to ${to.name}`,
      },
    }),
    db.inventoryMovement.create({
      data: {
        productId,
        warehouseId: toId,
        type: "TRANSFER",
        bottles,
        date,
        notes: notes || `Transfer from ${from.name}`,
      },
    }),
  ]);

  revalidatePath("/inventory");
  revalidatePath("/");
  redirect(`/inventory?moved=${bottles}`);
}
