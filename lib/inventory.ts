import { db } from "./db";

export type StockRow = {
  productId: string;
  sku: string;
  name: string;
  bottlesPerCase: number;
  byWarehouse: Record<string, number>; // warehouseId -> bottles
  totalBottles: number;
};

/** On-hand stock per product, computed from the movement ledger. */
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
