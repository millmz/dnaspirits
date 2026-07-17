"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toCents, toFloat, toDate } from "@/lib/format";
import { recalcProductsUsingComponents } from "@/lib/bom-cost";
import { getComponentStock } from "@/lib/inventory";

const MAX_LINES = 5;

export async function createPO(formData: FormData) {
  await requireOps();

  const lines: { componentId: string; qty: number; unitCostCents: number }[] = [];
  for (let i = 0; i < MAX_LINES; i++) {
    const componentId = String(formData.get(`line${i}_componentId`) ?? "");
    const qty = toFloat(formData.get(`line${i}_qty`) as string);
    if (!componentId || qty <= 0) continue;
    const priceRaw = String(formData.get(`line${i}_cost`) ?? "").trim();
    let unitCostCents = toCents(priceRaw);
    if (!priceRaw) {
      const c = await db.component.findUnique({ where: { id: componentId } });
      unitCostCents = c?.unitCostCents ?? 0;
    }
    lines.push({ componentId, qty, unitCostCents });
  }
  if (lines.length === 0) redirect("/purchasing?err=Add+at+least+one+line+with+a+component+and+quantity");

  const poNumber = String(formData.get("poNumber") ?? "").trim().toUpperCase();
  if (await db.purchaseOrder.findUnique({ where: { poNumber } })) {
    redirect(`/purchasing?err=${encodeURIComponent(`PO number ${poNumber} already exists — pick another.`)}`);
  }

  const expectedRaw = String(formData.get("expectedDate") ?? "").trim();
  await db.purchaseOrder.create({
    data: {
      poNumber,
      supplierId: String(formData.get("supplierId")),
      orderDate: toDate(formData.get("orderDate") as string),
      expectedDate: expectedRaw ? toDate(expectedRaw) : null,
      notes: String(formData.get("notes") ?? "").trim(),
      status: "ORDERED",
      lines: { create: lines },
    },
  });
  revalidatePath("/purchasing");
}

/** Receiving a PO posts each line into dry-goods stock and updates unit costs. */
export async function receivePO(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const po = await db.purchaseOrder.findUniqueOrThrow({
    where: { id },
    include: { lines: true },
  });
  if (po.status !== "ORDERED") return;

  const receivedDate = toDate(formData.get("receivedDate") as string);
  await db.$transaction([
    db.purchaseOrder.update({
      where: { id },
      data: { status: "RECEIVED", receivedDate },
    }),
    ...po.lines.map((line) =>
      db.componentMovement.create({
        data: {
          componentId: line.componentId,
          type: "PO_RECEIPT",
          qty: line.qty,
          date: receivedDate,
          reference: po.poNumber,
        },
      })
    ),
    ...po.lines
      .filter((l) => l.unitCostCents > 0)
      .map((line) =>
        db.component.update({
          where: { id: line.componentId },
          data: { unitCostCents: line.unitCostCents },
        })
      ),
  ]);
  // received costs may differ — flow them through the BOMs into product COGS
  await recalcProductsUsingComponents(po.lines.map((l) => l.componentId));
  revalidatePath("/purchasing");
  revalidatePath("/products");
  revalidatePath("/components");
  revalidatePath("/");
}

/**
 * Undo a mistaken receipt: removes the stock the receipt added and puts the
 * PO back to ORDERED. Refuses if the stock has since been used (a reversal
 * would drive a component negative). Unit costs are left as-is.
 */
export async function unreceivePO(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const po = await db.purchaseOrder.findUniqueOrThrow({
    where: { id },
    include: { lines: { include: { component: true } } },
  });
  if (po.status !== "RECEIVED") return;

  const stock = await getComponentStock();
  const short = po.lines.filter((l) => (stock.get(l.componentId) ?? 0) < l.qty);
  if (short.length > 0) {
    const msg = short.map((l) => l.component.name).join(", ");
    redirect(
      `/purchasing?err=${encodeURIComponent(
        `Can't un-receive ${po.poNumber} — some of that stock has already been used (${msg}).`
      )}`
    );
  }

  await db.$transaction([
    db.componentMovement.deleteMany({
      where: { type: "PO_RECEIPT", reference: po.poNumber },
    }),
    db.purchaseOrder.update({
      where: { id },
      data: { status: "ORDERED", receivedDate: null },
    }),
  ]);
  revalidatePath("/purchasing");
  revalidatePath("/components");
  revalidatePath("/");
}

export async function cancelPO(formData: FormData) {
  await requireOps();
  const id = String(formData.get("id"));
  const po = await db.purchaseOrder.findUnique({ where: { id } });
  if (!po || po.status !== "ORDERED") return;
  await db.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidatePath("/purchasing");
}
