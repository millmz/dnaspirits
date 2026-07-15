import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const existing = await db.user.count();
  if (existing > 0) {
    console.log("Database already seeded — skipping.");
    return;
  }

  await db.user.create({
    data: {
      email: "admin@denada.com",
      name: "Admin",
      passwordHash: await bcrypt.hash("denada123", 10),
      role: "ADMIN",
    },
  });

  const warehouse = await db.warehouse.create({
    data: { name: "Distillery Warehouse (MX)", location: "Jalisco, Mexico" },
  });

  const importer = await db.importer.create({
    data: { name: "My Importer (rename me)", country: "USA" },
  });

  const [blanco, repo, anejo] = await Promise.all([
    db.product.create({
      data: {
        sku: "DN-BLANCO-750",
        name: "De Nada Blanco 750ml",
        tier: "BLANCO",
        bottlesPerCase: 6,
        caseCostCents: 9000,
        exWorksCents: 18000,
      },
    }),
    db.product.create({
      data: {
        sku: "DN-REPO-750",
        name: "De Nada Reposado 750ml",
        tier: "REPOSADO",
        bottlesPerCase: 6,
        caseCostCents: 10500,
        exWorksCents: 21000,
      },
    }),
    db.product.create({
      data: {
        sku: "DN-ANEJO-750",
        name: "De Nada Añejo 750ml",
        tier: "ANEJO",
        bottlesPerCase: 6,
        caseCostCents: 13000,
        exWorksCents: 27000,
      },
    }),
  ]);

  const supplier = await db.supplier.create({
    data: { name: "Example Supplier (rename me)", location: "Guadalajara, MX" },
  });

  const mk = (name, category, unitCostCents, reorderPoint, unit = "pcs") =>
    db.component.create({
      data: {
        name,
        category,
        unit,
        unitCostCents,
        reorderPoint,
        supplierId: supplier.id,
      },
    });

  const [glass, label, cork, shipper, capsule, bulk] = await Promise.all([
    mk("Glass Bottle 750ml", "GLASS", 180, 5000),
    mk("Label Set (front + back)", "LABEL", 35, 5000),
    mk("Stopper / Cork", "CLOSURE", 45, 5000),
    mk("Shipper Box (6-pack)", "SHIPPER", 210, 800),
    mk("Capsule / Foil", "CAPSULE", 12, 5000),
    mk("Bulk Tequila (liters)", "BULK_TEQUILA", 950, 1000, "liters"),
  ]);

  // Default BOM shared by all three expressions:
  // per bottle — 1 glass, 1 label set, 1 cork, 1 capsule, 0.75 L bulk; per case — 1 shipper box
  for (const p of [blanco, repo, anejo]) {
    await db.bomItem.createMany({
      data: [
        { productId: p.id, componentId: glass.id, qty: 1, per: "BOTTLE" },
        { productId: p.id, componentId: label.id, qty: 1, per: "BOTTLE" },
        { productId: p.id, componentId: cork.id, qty: 1, per: "BOTTLE" },
        { productId: p.id, componentId: capsule.id, qty: 1, per: "BOTTLE" },
        { productId: p.id, componentId: bulk.id, qty: 0.75, per: "BOTTLE" },
        { productId: p.id, componentId: shipper.id, qty: 1, per: "CASE" },
      ],
    });
  }

  console.log("Seeded De Nada operations:");
  console.log("  admin login  admin@denada.com / denada123  (change immediately)");
  console.log("  warehouse    " + warehouse.name);
  console.log("  importer     " + importer.name);
  console.log("  3 SKUs (Blanco / Reposado / Añejo) with default BOMs");
  console.log("  6 dry-goods components + example supplier");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
