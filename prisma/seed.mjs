import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

/**
 * Minimal seed: an admin login and the importer relationship only.
 * Products, SKUs, costs, components, suppliers and warehouses are real
 * business data — they are entered by the team (Products & BOM, Dry Goods,
 * Settings pages) or created automatically by report imports, never seeded.
 */
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

  const importer = await db.importer.create({
    data: { name: "Luxury Spirits International (LSI)", country: "USA" },
  });

  console.log("Seeded De Nada operations:");
  console.log("  admin login  admin@denada.com / denada123  (change immediately)");
  console.log("  importer     " + importer.name);
  console.log("  Everything else starts blank — set up Products, Dry Goods and");
  console.log("  Warehouses in the app, then upload your monthly reports.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
