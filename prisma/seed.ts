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
    data: { name: "Main Warehouse", location: "Set your location" },
  });

  await db.product.createMany({
    data: [
      {
        sku: "DN-BLANCO-750",
        name: "Denada Blanco 750ml",
        sizeMl: 750,
        abv: 40,
        bottlesPerCase: 6,
        caseCostCents: 9000,
        casePriceCents: 18000,
      },
      {
        sku: "DN-REPO-750",
        name: "Denada Reposado 750ml",
        sizeMl: 750,
        abv: 40,
        bottlesPerCase: 6,
        caseCostCents: 10500,
        casePriceCents: 21000,
      },
      {
        sku: "DN-ANEJO-750",
        name: "Denada Añejo 750ml",
        sizeMl: 750,
        abv: 40,
        bottlesPerCase: 6,
        caseCostCents: 13000,
        casePriceCents: 27000,
      },
    ],
  });

  console.log("Seeded: admin user (admin@denada.com / denada123), warehouse:", warehouse.name);
  console.log("IMPORTANT: change the admin password after first login (Settings → Team).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
