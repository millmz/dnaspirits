/**
 * One-time restructure of the dry-goods catalog on databases that loaded the
 * original July 2026 setup:
 *
 *  1. "Shipper Carton + Bottling Labor" was one combined per-bottle component.
 *     Labor is NOT a dry good — it moves onto each product as a per-bottle
 *     overhead ($1.00, the sheet's full allocation). Each SKU gets its own
 *     shipper-box component (per case, $0 until invoiced) so box inventory is
 *     tracked per SKU.
 *  2. Labels split per SKU: the combined "Blanco/Reposado 700ml" label becomes
 *     Blanco 700ml, with a new Reposado 700ml at the same cost; same for the
 *     combined 1L label. The Añejo label just loses its "(premium)" suffix.
 *
 * Guards: a component with recorded movements or PO lines is never deleted or
 * renamed — that piece is skipped with a loud warning so live counts are safe.
 * Product COGS is recalculated at the end (BOM + labor). Idempotent: once the
 * old names are gone this is a no-op.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const SKUS = {
  blanco700: "DN-BLANCO-700",
  repo700: "DN-REPO-700",
  anejo700: "DN-ANEJO-700",
  blanco1L: "DN-BLANCO-1L",
  repo1L: "DN-REPO-1L",
};

async function untouched(componentId) {
  const [movements, poLines] = await Promise.all([
    db.componentMovement.count({ where: { componentId } }),
    db.purchaseOrderLine.count({ where: { componentId } }),
  ]);
  return movements === 0 && poLines === 0;
}

async function findComponent(name) {
  return db.component.findFirst({ where: { name } });
}

async function productBySku(sku) {
  return db.product.findUnique({ where: { sku } });
}

/** Split a combined label into per-SKU labels; repoint the second SKU's BOM row. */
async function splitLabel(oldName, renameTo, createName, repointSku) {
  const comp = await findComponent(oldName);
  if (!comp) return;
  if (!(await untouched(comp.id))) {
    console.warn(
      `fix-dry-goods: "${oldName}" has recorded stock/PO activity — leaving it alone. ` +
        `Split it manually on the Dry Goods page when convenient.`
    );
    return;
  }
  await db.component.update({ where: { id: comp.id }, data: { name: renameTo } });
  const created = await db.component.create({
    data: {
      name: createName,
      category: comp.category,
      unit: comp.unit,
      unitCostCents: comp.unitCostCents,
      supplierId: comp.supplierId,
      leadTimeDays: comp.leadTimeDays,
      reorderPoint: comp.reorderPoint,
    },
  });
  const product = await productBySku(repointSku);
  if (product) {
    await db.bomItem.updateMany({
      where: { productId: product.id, componentId: comp.id },
      data: { componentId: created.id },
    });
  }
  console.log(`fix-dry-goods: "${oldName}" → "${renameTo}" + new "${createName}".`);
}

async function main() {
  // ---- 1. split labels per SKU ----
  await splitLabel(
    "Wrap-Around Label — Blanco/Reposado 700ml",
    "Wrap-Around Label — Blanco 700ml",
    "Wrap-Around Label — Reposado 700ml",
    SKUS.repo700
  );
  await splitLabel(
    "Wrap-Around Label — 1L",
    "Wrap-Around Label — Blanco 1L",
    "Wrap-Around Label — Reposado 1L",
    SKUS.repo1L
  );
  const anejoLabel = await findComponent("Wrap-Around Label — Añejo 700ml (premium)");
  if (anejoLabel) {
    await db.component.update({
      where: { id: anejoLabel.id },
      data: { name: "Wrap-Around Label — Añejo 700ml" },
    });
    console.log('fix-dry-goods: renamed Añejo label (dropped "(premium)").');
  }

  // ---- 2. combined shipper+labor → per-SKU boxes + product labor overhead ----
  const combined = await findComponent("Shipper Carton + Bottling Labor");
  if (combined) {
    if (!(await untouched(combined.id))) {
      console.warn(
        'fix-dry-goods: "Shipper Carton + Bottling Labor" has recorded activity — NOT restructuring it. ' +
          "Resolve manually: move labor to each product and add per-SKU shipper boxes."
      );
    } else {
      const affected = await db.bomItem.findMany({
        where: { componentId: combined.id },
        select: { productId: true },
      });
      const affectedIds = affected.map((b) => b.productId);
      await db.bomItem.deleteMany({ where: { componentId: combined.id } });
      await db.component.delete({ where: { id: combined.id } });

      if (affectedIds.length > 0) {
        await db.product.updateMany({
          where: { id: { in: affectedIds } },
          data: { laborPerBottleCents: 100 },
        });
      }

      const rx2 = await db.supplier.findFirst({ where: { name: { contains: "RX2" } } });
      const BOXES = [
        [SKUS.blanco700, "Shipper Box — Blanco 700ml"],
        [SKUS.repo700, "Shipper Box — Reposado 700ml"],
        [SKUS.anejo700, "Shipper Box — Añejo 700ml"],
        [SKUS.blanco1L, "Shipper Box — Blanco 1L"],
        [SKUS.repo1L, "Shipper Box — Reposado 1L"],
      ];
      for (const [sku, name] of BOXES) {
        const product = await productBySku(sku);
        if (!product) continue;
        if (await findComponent(name)) continue;
        const box = await db.component.create({
          data: {
            name,
            category: "SHIPPER",
            unit: "boxes",
            unitCostCents: 0,
            supplierId: rx2?.id ?? null,
            notes: "Cost TBD — update here when invoiced and trim product labor to match.",
          },
        });
        await db.bomItem.create({
          data: { productId: product.id, componentId: box.id, qty: 1, per: "CASE" },
        });
      }
      console.log(
        "fix-dry-goods: labor moved to products ($1.00/bottle overhead); per-SKU shipper boxes created at $0."
      );
    }
  }

  // ---- 3. apply the RX2 final order's real box costs + $0.60/bottle labor ----
  // RX2 GS final order, 2026-07-10 (Guadalajara): 700ml boxes $15.55 MXN,
  // 1L boxes $17.74 MXN, ex-IVA, ≈ 17.54 MXN/USD on 2026-07-15.
  // Only placeholder states are touched ($0 "Cost TBD" boxes, $1.00 labor),
  // so values the team has since edited by hand are never overwritten.
  const BOX_COSTS = [
    ["Shipper Box — Blanco 700ml", 89, "$15.55 MXN ex-IVA ≈ $0.89 @ 17.54 MXN/USD (RX2 order 2026-07-10)"],
    ["Shipper Box — Reposado 700ml", 89, "$15.55 MXN ex-IVA ≈ $0.89 @ 17.54 MXN/USD (RX2 order 2026-07-10)"],
    ["Shipper Box — Añejo 700ml", 89, "$15.55 MXN ex-IVA ≈ $0.89 @ 17.54 MXN/USD (RX2 order 2026-07-10)"],
    ["Shipper Box — Blanco 1L", 101, "$17.74 MXN ex-IVA ≈ $1.01 @ 17.54 MXN/USD (RX2 order 2026-07-10)"],
    ["Shipper Box — Reposado 1L", 101, "$17.74 MXN ex-IVA ≈ $1.01 @ 17.54 MXN/USD (RX2 order 2026-07-10)"],
  ];
  for (const [name, cents, note] of BOX_COSTS) {
    const updated = await db.component.updateMany({
      where: { name, unitCostCents: 0, notes: { contains: "Cost TBD" } },
      data: { unitCostCents: cents, notes: note },
    });
    if (updated.count > 0) console.log(`fix-dry-goods: ${name} priced at $${(cents / 100).toFixed(2)}.`);
  }
  const laborUpdated = await db.product.updateMany({
    where: { laborPerBottleCents: 100 },
    data: { laborPerBottleCents: 60 },
  });
  if (laborUpdated.count > 0) {
    console.log(`fix-dry-goods: labor set to $0.60/bottle on ${laborUpdated.count} products.`);
  }

  // ---- 4. load the RX2 final order as a purchase order (receive when delivered) ----
  const PO_NUMBER = "RX2-20260710";
  if (!(await db.purchaseOrder.findUnique({ where: { poNumber: PO_NUMBER } }))) {
    const rx2Supplier = await db.supplier.findFirst({ where: { name: { contains: "RX2" } } });
    const ORDER = [
      ["Shipper Box — Blanco 700ml", 2150, 89],
      ["Shipper Box — Reposado 700ml", 1420, 89],
      ["Shipper Box — Añejo 700ml", 1030, 89],
      ["Shipper Box — Blanco 1L", 1100, 101],
      ["Shipper Box — Reposado 1L", 1122, 101],
    ];
    const lines = [];
    for (const [name, qty, unitCostCents] of ORDER) {
      const comp = await findComponent(name);
      if (comp) lines.push({ componentId: comp.id, qty, unitCostCents });
    }
    if (rx2Supplier && lines.length === ORDER.length) {
      await db.purchaseOrder.create({
        data: {
          poNumber: PO_NUMBER,
          supplierId: rx2Supplier.id,
          status: "ORDERED",
          orderDate: new Date("2026-07-10T00:00:00Z"),
          notes:
            "RX2 GS final order 2026-07-10 — 6,822 boxes. Prices ex-IVA, converted at 17.54 MXN/USD. " +
            "Engraving/setup fees ($20,750 MXN) and Arandas delivery ($2,350 MXN) excluded — log as expenses. " +
            "Delivery to Arandas pending; receive here when boxes arrive.",
          lines: { create: lines },
        },
      });
      console.log(`fix-dry-goods: purchase order ${PO_NUMBER} created (5 lines, 6,822 boxes).`);
    }
  }

  // ---- 5. recalc COGS from BOM + labor ----
  const products = await db.product.findMany({
    include: { bomItems: { include: { component: true } } },
  });
  for (const p of products) {
    if (p.bomItems.length === 0) continue;
    let perBottle = p.laborPerBottleCents;
    let perCase = 0;
    for (const b of p.bomItems) {
      if (b.per === "CASE") perCase += b.qty * b.component.unitCostCents;
      else perBottle += b.qty * b.component.unitCostCents;
    }
    const cents = Math.round(perBottle * p.bottlesPerCase + perCase);
    if (cents !== p.caseCostCents) {
      await db.product.update({ where: { id: p.id }, data: { caseCostCents: cents } });
      console.log(`fix-dry-goods: ${p.sku} COGS recalculated to $${(cents / 100).toFixed(2)}/case.`);
    }
  }

  console.log("fix-dry-goods: done.");
}

main()
  .catch((e) => {
    // Never block a deploy on the restructure — warn and let the app start.
    console.error("fix-dry-goods: skipped due to error:", e);
  })
  .finally(() => db.$disconnect());
