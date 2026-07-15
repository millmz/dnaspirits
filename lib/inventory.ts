import { db } from "./db";

export type StockRow = {
  productId: string;
  sku: string;
  name: string;
  tier: string;
  bottlesPerCase: number;
  byWarehouse: Record<string, number>; // warehouseId -> bottles
  totalBottles: number;
};

/** Finished-goods stock per product, computed from the movement ledger. */
export async function getStock(): Promise<StockRow[]> {
  const [products, sums] = await Promise.all([
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
    db.inventoryMovement.groupBy({
      by: ["productId", "warehouseId"],
      _sum: { bottles: true },
    }),
  ]);
  return products.map((p) => {
    const rows = sums.filter((s) => s.productId === p.id);
    const byWarehouse: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const b = r._sum.bottles ?? 0;
      byWarehouse[r.warehouseId] = (byWarehouse[r.warehouseId] ?? 0) + b;
      total += b;
    }
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      tier: p.tier,
      bottlesPerCase: p.bottlesPerCase,
      byWarehouse,
      totalBottles: total,
    };
  });
}

export async function getStockForWarehouse(
  productId: string,
  warehouseId: string
): Promise<number> {
  const agg = await db.inventoryMovement.aggregate({
    where: { productId, warehouseId },
    _sum: { bottles: true },
  });
  return agg._sum.bottles ?? 0;
}

/** Dry-goods on hand per component (from the component movement ledger). */
export async function getComponentStock(): Promise<Map<string, number>> {
  const sums = await db.componentMovement.groupBy({
    by: ["componentId"],
    _sum: { qty: true },
  });
  return new Map(sums.map((s) => [s.componentId, s._sum.qty ?? 0]));
}

/**
 * Components a production run will consume, from the product's BOM.
 * Returns [{componentId, name, unit, needed}]
 */
export async function bomRequirements(productId: string, bottles: number) {
  const [product, bom] = await Promise.all([
    db.product.findUniqueOrThrow({ where: { id: productId } }),
    db.bomItem.findMany({ where: { productId }, include: { component: true } }),
  ]);
  const cases = bottles / product.bottlesPerCase;
  return bom.map((b) => ({
    componentId: b.componentId,
    name: b.component.name,
    unit: b.component.unit,
    needed: b.per === "CASE" ? b.qty * cases : b.qty * bottles,
  }));
}
