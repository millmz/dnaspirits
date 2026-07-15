-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'BLANCO',
    "sizeMl" INTEGER NOT NULL DEFAULT 750,
    "abv" REAL NOT NULL DEFAULT 40,
    "bottlesPerCase" INTEGER NOT NULL DEFAULT 6,
    "casesPerPallet" INTEGER NOT NULL DEFAULT 140,
    "caseCostCents" INTEGER NOT NULL DEFAULT 0,
    "exWorksCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Product" ("abv", "active", "bottlesPerCase", "caseCostCents", "exWorksCents", "id", "name", "sizeMl", "sku", "tier") SELECT "abv", "active", "bottlesPerCase", "caseCostCents", "exWorksCents", "id", "name", "sizeMl", "sku", "tier" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
