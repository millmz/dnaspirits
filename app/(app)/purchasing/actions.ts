"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { toCents, toFloat, toDate } from "@/lib/format";

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
  if (lines.length === 0) return;

  const expectedRaw = String(formData.get("expectedDate") ?? "").trim();
  await db.purchaseOrder.create({
    data: {
      poNumber: String(formData.get("poNumber") ?? "").trim().toUpperCase(),
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
