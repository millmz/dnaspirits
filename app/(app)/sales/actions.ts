"use server";

import { redirect } from "next/navigation";
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
  if (lines.length === 0) redirect("/sales?err=Add+at+least+one+line+with+a+product+and+case+count");

  const dueRaw = String(formData.get("dueDate") ?? "").trim();
  await db.exWorksSale.create({
    data: {
      importerId: String(formData.get("importerId")),
      warehouseId: String(formData.get("warehouseId")),
      date: toDate(formData.get("date") as string),
      dueDate: dueRaw ? toDate(dueRaw) : null,
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
 * your inventory and the invoice becomes a receivable. Refuses if stock is
 * short — needs are summed per product so duplicate lines can't oversell.
 */
export async function confirmSale(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const sale = await db.exWorksSale.findUniqueOrThrow({
    where: { id },
    include: { lines: { include: { product: true } } },
  });
  if (sale.status !== "DRAFT") return;

  const needed = new Map<string, { bottles: number; name: string }>();
  for (const line of sale.lines) {
    const cur = needed.get(line.productId) ?? { bottles: 0, name: line.product.name };
    cur.bottles += line.cases * line.product.bottlesPerCase;
    needed.set(line.productId, cur);
  }
  for (const [productId, need] of needed) {
    const onHand = await getStockForWarehouse(productId, sale.warehouseId);
    if (onHand < need.bottles) {
      redirect(
        `/sales?err=${encodeURIComponent(
          `Not enough ${need.name} — need ${need.bottles} bottles, have ${onHand}. Sale stays draft.`
        )}`
      );
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

/**
 * Undo a mistaken confirmation: returns the bottles to inventory and puts the
 * sale back in DRAFT (where lines can be fixed or the sale deleted). Blocked
 * once any payment has been recorded — unwind the payment first.
 */
export async function unconfirmSale(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const sale = await db.exWorksSale.findUniqueOrThrow({ where: { id } });
  if (sale.status !== "CONFIRMED") return;
  if (sale.invoiceStatus === "PAID" || sale.amountPaidCents > 0) {
    redirect("/sales?err=This+invoice+has+payments+recorded+—+mark+it+unpaid+first");
  }
  await db.$transaction([
    db.inventoryMovement.deleteMany({ where: { saleId: id, type: "EX_WORKS_SALE" } }),
    db.exWorksSale.update({ where: { id }, data: { status: "DRAFT" } }),
  ]);
  revalidatePath("/sales");
  revalidatePath("/inventory");
  revalidatePath("/");
}

/** Record a (possibly partial) payment with its actual remittance date. */
export async function recordPayment(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const amountCents = toCents(formData.get("amount") as string);
  if (amountCents <= 0) redirect("/sales?err=Enter+a+payment+amount");
  const date = toDate(formData.get("date") as string);

  const sale = await db.exWorksSale.findUniqueOrThrow({
    where: { id },
    include: { lines: true },
  });
  const totalCents = sale.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
  const paid = sale.amountPaidCents + amountCents;
  await db.exWorksSale.update({
    where: { id },
    data: {
      amountPaidCents: paid,
      ...(paid >= totalCents ? { invoiceStatus: "PAID", paidDate: date } : {}),
    },
  });
  revalidatePath("/sales");
  revalidatePath("/accounting");
  revalidatePath("/");
}

/** Mark fully paid (records the full balance as paid on the given date). */
export async function markPaid(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const dateRaw = String(formData.get("date") ?? "").trim();
  const sale = await db.exWorksSale.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  const totalCents = sale.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
  await db.exWorksSale.update({
    where: { id },
    data: {
      invoiceStatus: "PAID",
      amountPaidCents: totalCents,
      paidDate: dateRaw ? toDate(dateRaw) : new Date(),
    },
  });
  revalidatePath("/sales");
  revalidatePath("/accounting");
  revalidatePath("/");
}

/** Undo a mistaken mark-paid: reopens the invoice and clears payments. */
export async function markUnpaid(formData: FormData) {
  await requireOps();
  await db.exWorksSale.update({
    where: { id: String(formData.get("id")) },
    data: { invoiceStatus: "UNPAID", amountPaidCents: 0, paidDate: null },
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
  if (amountCents <= 0) redirect("/sales?err=Enter+a+chargeback+amount");
  const importerId = String(formData.get("importerId"));
  const saleId = String(formData.get("saleId") ?? "").trim();

  if (saleId) {
    const sale = await db.exWorksSale.findUnique({ where: { id: saleId } });
    if (!sale || sale.importerId !== importerId) {
      redirect("/sales?err=That+invoice+belongs+to+a+different+importer");
    }
  }

  await db.chargeback.create({
    data: {
      importerId,
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
