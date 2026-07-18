"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireOps } from "@/lib/auth";
import { getComponentStock } from "@/lib/inventory";

export type Shortfall = {
  componentId: string;
  name: string;
  unit: string;
  supplierId: string;
  supplierName: string;
  need: number;
  onHand: number;
  short: number;
  unitCostCents: number;
  leadTimeDays: number;
};

/** BOM requirements vs on-hand for producing `cases` of a product. */
export async function computeShortfalls(productId: string, cases: number): Promise<Shortfall[]> {
  const [product, stock] = await Promise.all([
    db.product.findUnique({
      where: { id: productId },
      include: { bomItems: { include: { component: { include: { supplier: true } } } } },
    }),
    getComponentStock(),
  ]);
  if (!product || cases <= 0) return [];
  return product.bomItems.map((b) => {
    const need = b.per === "CASE" ? cases * b.qty : cases * product.bottlesPerCase * b.qty;
    const onHand = stock.get(b.componentId) ?? 0;
    return {
      componentId: b.componentId,
      name: b.component.name,
      unit: b.component.unit,
      supplierId: b.component.supplierId ?? "",
      supplierName: b.component.supplier?.name ?? "No supplier set",
      need: Math.ceil(need * 100) / 100,
      onHand: Math.round(onHand * 100) / 100,
      short: Math.max(0, Math.ceil((need - onHand) * 100) / 100),
      unitCostCents: b.component.unitCostCents,
      leadTimeDays: b.component.leadTimeDays,
    };
  });
}

/** One-click PO covering a supplier's shortfalls for the planned run. */
export async function createShortfallPO(formData: FormData) {
  await requireOps();
  const productId = String(formData.get("productId"));
  const cases = Number(formData.get("cases"));
  const supplierId = String(formData.get("supplierId"));
  if (!supplierId) redirect(`/production/plan?product=${productId}&cases=${cases}&err=${encodeURIComponent("That component has no supplier set — add one on the Dry Goods page first.")}`);

  const shortfalls = (await computeShortfalls(productId, cases)).filter(
    (s) => s.supplierId === supplierId && s.short > 0
  );
  if (shortfalls.length === 0) redirect(`/production/plan?product=${productId}&cases=${cases}`);

  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  let poNumber = `PO-${stamp}-PLAN`;
  for (let n = 2; await db.purchaseOrder.findUnique({ where: { poNumber } }); n++) {
    poNumber = `PO-${stamp}-PLAN${n}`;
  }
  const po = await db.purchaseOrder.create({
    data: {
      poNumber,
      supplierId,
      status: "ORDERED",
      orderDate: new Date(),
      notes: `Auto-drafted from run planner (${cases} cases)`,
      lines: {
        create: shortfalls.map((s) => ({
          componentId: s.componentId,
          qty: Math.ceil(s.short),
          unitCostCents: s.unitCostCents,
        })),
      },
    },
  });
  redirect(`/purchasing?created=${encodeURIComponent(po.poNumber)}`);
}
