"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toCents, toInt, toDate } from "@/lib/format";
import { getStockForWarehouse } from "@/lib/inventory";

const MAX_LINES = 5;

export async function createSale(formData: FormData) {
  await requireOps();

  const lines: { productId: string; cases: number; pricePerCaseCents: number }[] = [];
  for (let i = 0; i < MAX_LINES; i++) {
    const productId = String(formData.get(`line${i}_productId`) ?? "");
    const cases = toInt(formData.get(`line${i}_cases`) as string);
    if (!productId || cases <= 0) continue;
    const priceRaw = String(formData.get(`line${i}_price`) ?? "").trim();
    let pricePerCaseCents = toCents(priceRaw);
    if (!priceRaw) {
      const product = await db.product.findUnique({ where: { id: productId } });
      pricePerCaseCents = product?.exWorksCents ?? 0;
    }
    lines.push({ productId, cases, pricePerCaseCents });
  }
  if (lines.length === 0) return;

  await db.exWorksSale.create({
    data: {
      importerId: String(formData.get("importerId")),
      warehouseId: String(formData.get("warehouseId")),
      date: toDate(formData.get("date") as string),
      invoiceNumber: String(formData.get("invoiceNumber") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
      status: "DRAFT",
      lines: { create: lines },
    },
  });
  revalidatePath("/sales");
}

/**
 * Confirming an ex-works sale is the ownership handoff: finished goods leave
 * your inventory and the invoice becomes a receivable. Refuses if stock is short.
 */
export async function confirmSale(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const sale = await db.exWorksSale.findUniqueOrThrow({
    where: { id },
    include: { lines: { include: { product: true } } },
  });
  if (sale.status !== "DRAFT") return;

  for (const line of sale.lines) {
    const onHand = await getStockForWarehouse(line.productId, sale.warehouseId);
    if (onHand < line.cases * line.product.bottlesPerCase) {
      revalidatePath("/sales");
      return; // not enough finished goods — stays draft
    }
  }

  await db.$transaction([
    db.exWorksSale.update({ where: { id }, data: { status: "CONFIRMED" } }),
    ...sale.lines.map((line) =>
      db.inventoryMovement.create({
        data: {
          productId: line.productId,
          warehouseId: sale.warehouseId,
          saleId: id,
          type: "EX_WORKS_SALE",
          bottles: -(line.cases * line.product.bottlesPerCase),
          date: sale.date,
          notes: `Ex-works${sale.invoiceNumber ? ` · Inv ${sale.invoiceNumber}` : ""}`,
        },
      })
    ),
  ]);
  revalidatePath("/sales");
  revalidatePath("/inventory");
  revalidatePath("/");
}

export async function markPaid(formData: FormData) {
  await requireOps();
  await db.exWorksSale.update({
    where: { id: String(formData.get("id")) },
    data: { invoiceStatus: "PAID", paidDate: new Date() },
  });
  revalidatePath("/sales");
  revalidatePath("/accounting");
  revalidatePath("/");
}

/**
 * Records an importer chargeback (distributor promo, samples, freight,
 * marketing billback). Optionally applied against a specific invoice —
 * applied credits reduce that invoice's collectible balance everywhere
 * receivables are shown.
 */
export async function createChargeback(formData: FormData) {
  await requireOps();
  const amountCents = toCents(formData.get("amount") as string);
  if (amountCents <= 0) return;
  const saleId = String(formData.get("saleId") ?? "").trim();
  await db.chargeback.create({
    data: {
      importerId: String(formData.get("importerId")),
      saleId: saleId || null,
      date: toDate(formData.get("date") as string),
      category: String(formData.get("category") ?? "OTHER"),
      amountCents,
      reference: String(formData.get("reference") ?? "").trim(),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/sales");
  revalidatePath("/accounting");
  revalidatePath("/");
}

export async function deleteChargeback(formData: FormData) {
  await requireOps();
  await db.chargeback.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/sales");
  revalidatePath("/accounting");
  revalidatePath("/");
}

export async function deleteDraft(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const sale = await db.exWorksSale.findUnique({ where: { id } });
  if (!sale || sale.status !== "DRAFT") return;
  await db.exWorksSale.delete({ where: { id } });
  revalidatePath("/sales");
}
