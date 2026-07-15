import { db } from "./db";

type BomLine = { qty: number; per: string; component: { unitCostCents: number } };

/**
 * COGS per case: per-bottle components × bottles per case, plus per-case
 * components (e.g. shipper boxes), plus bottling labor & overhead — a cost
 * that belongs in COGS but is not a tracked dry good. This is the single
 * source of truth for product cost whenever a BOM exists — FOB pricing lives
 * separately on the product and never moves when costs change.
 */
export function caseCostFromBom(
  bomItems: BomLine[],
  bottlesPerCase: number,
  laborPerBottleCents = 0
): number {
  let perBottle = laborPerBottleCents;
  let perCase = 0;
  for (const b of bomItems) {
    if (b.per === "CASE") perCase += b.qty * b.component.unitCostCents;
    else perBottle += b.qty * b.component.unitCostCents;
  }
  return Math.round(perBottle * bottlesPerCase + perCase);
}

/**
 * Re-derive stored COGS for products from their BOMs (products without a BOM
 * keep their manually entered cost). Completed production runs are never
 * touched — each run snapshots its cost at completion, so historical
 * production costs survive later component-price or packaging changes.
 */
export async function recalcProductCosts(productIds?: string[]) {
  const products = await db.product.findMany({
    where: productIds ? { id: { in: productIds } } : {},
    include: { bomItems: { include: { component: true } } },
  });
  for (const p of products) {
    if (p.bomItems.length === 0) continue;
    const cents = caseCostFromBom(p.bomItems, p.bottlesPerCase, p.laborPerBottleCents);
    if (cents !== p.caseCostCents) {
      await db.product.update({ where: { id: p.id }, data: { caseCostCents: cents } });
    }
  }
}

/** After a component's unit cost changes, refresh every product that uses it. */
export async function recalcProductsUsingComponents(componentIds: string[]) {
  if (componentIds.length === 0) return;
  const boms = await db.bomItem.findMany({
    where: { componentId: { in: componentIds } },
    select: { productId: true },
  });
  const ids = [...new Set(boms.map((b) => b.productId))];
  if (ids.length > 0) await recalcProductCosts(ids);
}
