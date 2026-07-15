"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toCents, toInt, toDate } from "@/lib/format";
import { getStockForWarehouse } from "@/lib/inventory";

const MAX_LINES = 5;

export async function createShipment(formData: FormData) {
  await requireUser();

  const lines: { productId: string; cases: number; pricePerCaseCents: number }[] = [];
  for (let i = 0; i < MAX_LINES; i++) {
    const productId = String(formData.get(`line${i}_productId`) ?? "");
    const cases = toInt(formData.get(`line${i}_cases`) as string);
    if (!productId || cases <= 0) continue;
    const priceRaw = String(formData.get(`line${i}_price`) ?? "").trim();
    let pricePerCaseCents = toCents(priceRaw);
    if (!priceRaw) {
      const product = await db.product.findUnique({ where: { id: productId } });
      pricePerCaseCents = product?.casePriceCents ?? 0;
    }
    lines.push({ productId, cases, pricePerCaseCents });
  }
  if (lines.length === 0) return;

  await db.shipment.create({
    data: {
      distributorId: String(formData.get("distributorId")),
      warehouseId: String(formData.get("warehouseId")),
      date: toDate(formData.get("date") as string),
      invoiceNumber: String(formData.get("invoiceNumber") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
      status: "DRAFT",
      lines: { create: lines },
    },
  });
  revalidatePath("/shipments");
}

/**
 * Marking a shipment shipped posts negative SHIPMENT movements so inventory
 * draws down. Refuses (silently keeps draft) if stock would go negative.
 */
export async function markShipped(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const shipment = await db.shipment.findUniqueOrThrow({
    where: { id },
    include: { lines: { include: { product: true } } },
  });
  if (shipment.status !== "DRAFT") return;

  for (const line of shipment.lines) {
    const onHand = await getStockForWarehouse(line.productId, shipment.warehouseId);
    const needed = line.cases * line.product.bottlesPerCase;
    if (onHand < needed) {
      revalidatePath("/shipments");
      return; // not enough stock — leave as draft
    }
  }

  await db.$transaction([
    db.shipment.update({ where: { id }, data: { status: "SHIPPED" } }),
    ...shipment.lines.map((line) =>
      db.inventoryMovement.create({
        data: {
          productId: line.productId,
          warehouseId: shipment.warehouseId,
          shipmentId: id,
          type: "SHIPMENT",
          bottles: -(line.cases * line.product.bottlesPerCase),
          date: shipment.date,
          notes: `Shipment${shipment.invoiceNumber ? ` · Inv ${shipment.invoiceNumber}` : ""}`,
        },
      })
    ),
  ]);
  revalidatePath("/shipments");
  revalidatePath("/inventory");
  revalidatePath("/");
}

export async function markPaid(formData: FormData) {
  await requireUser();
  await db.shipment.update({
    where: { id: String(formData.get("id")) },
    data: { invoiceStatus: "PAID", paidDate: new Date() },
  });
  revalidatePath("/shipments");
  revalidatePath("/accounting");
  revalidatePath("/");
}

export async function deleteDraft(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id"));
  const shipment = await db.shipment.findUnique({ where: { id } });
  if (!shipment || shipment.status !== "DRAFT") return;
  await db.shipment.delete({ where: { id } });
  revalidatePath("/shipments");
}
