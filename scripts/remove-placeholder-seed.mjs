/**
 * Removes the demo placeholder data that early seeds created (example SKUs,
 * costs, components, supplier, warehouse) so the live database starts blank
 * and the team enters real setup data themselves.
 *
 * Safety model — a record is deleted ONLY if BOTH hold:
 *   1. Fingerprint: it still matches the old seed exactly (same SKU/name and
 *      the same placeholder costs). Anything renamed or re-priced is treated
 *      as adopted real data and kept.
 *   2. Untouched: nothing references it — no production runs, movements,
 *      sales, POs, depletions or channel stock.
 * Runs on every deploy and is a no-op once clean.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const SEED_PRODUCTS = [
  { sku: "DN-BLANCO-750", name: "De Nada Blanco 750ml", caseCostCents: 9000, exWorksCents: 18000 },
  { sku: "DN-REPO-750", name: "De Nada Reposado 750ml", caseCostCents: 10500, exWorksCents: 21000 },
  { sku: "DN-ANEJO-750", name: "De Nada Añejo 750ml", caseCostCents: 13000, exWorksCents: 27000 },
];
const SEED_SUPPLIER = "Example Supplier (rename me)";
const SEED_COMPONENTS = [
  "Glass Bottle 750ml",
  "Label Set (front + back)",
  "Stopper / Cork",
  "Shipper Box (6-pack)",
  "Capsule / Foil",
  "Bulk Tequila (liters)",
];
const SEED_WAREHOUSE = "Distillery Warehouse (MX)";

async function main() {
  const removed = [];

  // ---- placeholder products (BOM rows cascade with the product) ----
  for (const fp of SEED_PRODUCTS) {
    const p = await db.product.findUnique({
      where: { sku: fp.sku },
      include: {
        _count: {
          select: {
            productionRuns: true,
            movements: true,
            saleLines: true,
            depletions: true,
            channelStocks: true,
            skuDepletions: true,
          },
        },
      },
    });
    if (!p) continue;
    const untouched = Object.values(p._count).every((n) => n === 0);
    const pristine =
      p.name === fp.name &&
      p.caseCostCents === fp.caseCostCents &&
      p.exWorksCents === fp.exWorksCents;
    if (pristine && untouched) {
      await db.product.delete({ where: { id: p.id } });
      removed.push(`product ${fp.sku}`);
    }
  }

  // ---- placeholder components + example supplier ----
  const supplier = await db.supplier.findFirst({
    where: { name: SEED_SUPPLIER },
    include: { _count: { select: { purchaseOrders: true } } },
  });
  if (supplier) {
    for (const name of SEED_COMPONENTS) {
      const c = await db.component.findFirst({
        where: { name, supplierId: supplier.id },
        include: { _count: { select: { movements: true, poLines: true } } },
      });
      if (!c) continue;
      if (c._count.movements === 0 && c._count.poLines === 0) {
        await db.bomItem.deleteMany({ where: { componentId: c.id } });
        await db.component.delete({ where: { id: c.id } });
        removed.push(`component ${name}`);
      }
    }
    const remaining = await db.component.count({ where: { supplierId: supplier.id } });
    if (remaining === 0 && supplier._count.purchaseOrders === 0) {
      await db.supplier.delete({ where: { id: supplier.id } });
      removed.push("example supplier");
    }
  }

  // ---- placeholder warehouse ----
  const wh = await db.warehouse.findFirst({
    where: { name: SEED_WAREHOUSE },
    include: { _count: { select: { movements: true, runs: true, sales: true } } },
  });
  if (wh) {
    const untouched = Object.values(wh._count).every((n) => n === 0);
    if (untouched) {
      await db.warehouse.delete({ where: { id: wh.id } });
      removed.push("placeholder warehouse");
    }
  }

  if (removed.length > 0) {
    console.log(`remove-placeholder-seed: removed ${removed.join(", ")}.`);
  } else {
    console.log("remove-placeholder-seed: nothing to remove.");
  }
}

main()
  .catch((e) => {
    // Never block a deploy over cleanup — the app works fine either way.
    console.error("remove-placeholder-seed: skipped due to error:", e.message);
  })
  .finally(() => db.$disconnect());
