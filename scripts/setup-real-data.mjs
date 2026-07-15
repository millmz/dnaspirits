/**
 * Loads De Nada's real catalog — suppliers, dry-goods components at actual
 * costs, the five SKUs with FOB pricing, exact BOMs, and both warehouses.
 *
 * Runs on deploy AFTER the placeholder cleanup. Guarded: it only loads when
 * the catalog is empty (no products AND no components), so it can never
 * overwrite data the team has entered or edited. Effectively one-time.
 *
 * Source: De Nada setup sheet (July 2026). COGS is intentionally NOT stored
 * here as a number — it's derived from the BOM so the check below proves the
 * component costs reproduce the sheet's COGS to the cent.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const [productCount, componentCount] = await Promise.all([
    db.product.count(),
    db.component.count(),
  ]);
  if (productCount > 0 || componentCount > 0) {
    console.log("setup-real-data: catalog already has data — skipping.");
    return;
  }

  // ---- suppliers ----
  const [nom, byquest, ccl, tapones, rx2] = await Promise.all([
    db.supplier.create({
      data: {
        name: "NOM 1414 — Feliciano Vivanco y Asociados",
        location: "Arandas, Jalisco, MX",
        notes: "Distillery: produces, bottles and supplies all De Nada tequila liquid.",
      },
    }),
    db.supplier.create({
      data: { name: "ByQuest Packaging", notes: "Glass bottles with custom etching." },
    }),
    db.supplier.create({
      data: { name: "CCL Label México", notes: "Wrap-around pressure-sensitive labels." },
    }),
    db.supplier.create({
      data: { name: "Tapones Premium / Metales Yonadab", notes: "Corks and closures." },
    }),
    db.supplier.create({
      data: { name: "RX2 GS SA de CV", notes: "Corrugated shipping cartons." },
    }),
  ]);

  // ---- components (unit costs in cents) ----
  const mk = (name, category, unitCostCents, supplierId, unit = "pcs", notes = "") =>
    db.component.create({
      data: { name, category, unit, unitCostCents, supplierId, notes },
    });

  const glass700 = await mk("Glass Bottle 700ml + Etching", "GLASS", 203, byquest.id);
  const glass1L = await mk("Glass Bottle 1L + Etching", "GLASS", 238, byquest.id);
  const label700 = await mk("Wrap-Around Label — Blanco/Reposado 700ml", "LABEL", 46, ccl.id);
  const labelAnejo = await mk("Wrap-Around Label — Añejo 700ml (premium)", "LABEL", 93, ccl.id);
  const label1L = await mk("Wrap-Around Label — 1L", "LABEL", 93, ccl.id);
  const cork = await mk("Cork / Stopper", "CLOSURE", 48, tapones.id);
  const shipper = await mk(
    "Shipper Carton + Bottling Labor",
    "SHIPPER",
    100,
    rx2.id,
    "pcs",
    "Combined corrugated case + bottling labor allocation, applied per bottle."
  );
  const blancoBulk = await mk("Blanco Tequila (bulk)", "BULK_TEQUILA", 1150, nom.id, "liters");
  const repoBulk = await mk("Reposado Tequila (bulk)", "BULK_TEQUILA", 1250, nom.id, "liters");
  const anejoBulk = await mk("Añejo Tequila (bulk)", "BULK_TEQUILA", 2400, nom.id, "liters");

  // ---- products + BOMs (FOB per case in cents, from the setup sheet) ----
  const CATALOG = [
    {
      sku: "DN-BLANCO-700", name: "De Nada Blanco 700ml", tier: "BLANCO", sizeMl: 700,
      fobCents: 11436, expectCogsCase: 7212,
      bom: [[glass700, 1], [label700, 1], [cork, 1], [shipper, 1], [blancoBulk, 0.7]],
    },
    {
      sku: "DN-REPO-700", name: "De Nada Reposado 700ml", tier: "REPOSADO", sizeMl: 700,
      fobCents: 12480, expectCogsCase: 7632,
      bom: [[glass700, 1], [label700, 1], [cork, 1], [shipper, 1], [repoBulk, 0.7]],
    },
    {
      sku: "DN-ANEJO-700", name: "De Nada Añejo 700ml", tier: "ANEJO", sizeMl: 700,
      fobCents: 16662, expectCogsCase: 12744,
      bom: [[glass700, 1], [labelAnejo, 1], [cork, 1], [shipper, 1], [anejoBulk, 0.7]],
    },
    {
      sku: "DN-BLANCO-1L", name: "De Nada Blanco 1L", tier: "BLANCO", sizeMl: 1000,
      fobCents: 14142, expectCogsCase: 9774,
      bom: [[glass1L, 1], [label1L, 1], [cork, 1], [shipper, 1], [blancoBulk, 1.0]],
    },
    {
      sku: "DN-REPO-1L", name: "De Nada Reposado 1L", tier: "REPOSADO", sizeMl: 1000,
      fobCents: 15600, expectCogsCase: 10374,
      bom: [[glass1L, 1], [label1L, 1], [cork, 1], [shipper, 1], [repoBulk, 1.0]],
    },
  ];

  for (const item of CATALOG) {
    const bottlesPerCase = 6;
    const perBottle = item.bom.reduce((a, [c, qty]) => a + qty * c.unitCostCents, 0);
    const cogsCase = Math.round(perBottle * bottlesPerCase);
    if (cogsCase !== item.expectCogsCase) {
      throw new Error(
        `${item.sku}: BOM-derived COGS ${cogsCase}¢/case does not match the setup sheet's ${item.expectCogsCase}¢ — aborting.`
      );
    }
    const product = await db.product.create({
      data: {
        sku: item.sku,
        name: item.name,
        tier: item.tier,
        sizeMl: item.sizeMl,
        abv: 40,
        bottlesPerCase,
        casesPerPallet: 140,
        caseCostCents: cogsCase,
        exWorksCents: item.fobCents,
      },
    });
    await db.bomItem.createMany({
      data: item.bom.map(([c, qty]) => ({
        productId: product.id,
        componentId: c.id,
        qty,
        per: "BOTTLE",
      })),
    });
    console.log(
      `setup-real-data: ${item.sku} — COGS $${(cogsCase / 100).toFixed(2)}/case (from BOM), FOB $${(item.fobCents / 100).toFixed(2)}/case`
    );
  }

  // ---- warehouses ----
  if ((await db.warehouse.count()) === 0) {
    await db.warehouse.create({
      data: {
        name: "NOM 1414 (Arandas, Jalisco)",
        location: "Arandas, Jalisco, MX — finished goods awaiting export",
      },
    });
    await db.warehouse.create({
      data: {
        name: "Western Carriers",
        location: "USA — primary U.S. warehouse for imported finished goods",
      },
    });
    console.log("setup-real-data: warehouses NOM 1414 (MX) + Western Carriers (US) created.");
  }

  console.log("setup-real-data: De Nada catalog loaded — 5 suppliers, 10 components, 5 SKUs with BOMs.");
}

main()
  .catch((e) => {
    console.error("setup-real-data failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
