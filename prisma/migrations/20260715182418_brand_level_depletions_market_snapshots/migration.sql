-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "ytdCases" REAL NOT NULL,
    "ytdCasesLY" REAL,
    "accounts" INTEGER NOT NULL,
    "accountsLY" INTEGER,
    "velocity" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSnapshot_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "Importer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Depletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "distributorId" TEXT NOT NULL,
    "productId" TEXT,
    "period" TEXT NOT NULL,
    "accountName" TEXT NOT NULL DEFAULT '',
    "accountType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "cases" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Depletion_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Depletion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Depletion" ("accountName", "accountType", "cases", "createdAt", "distributorId", "id", "period", "productId", "source") SELECT "accountName", "accountType", "cases", "createdAt", "distributorId", "id", "period", "productId", "source" FROM "Depletion";
DROP TABLE "Depletion";
ALTER TABLE "new_Depletion" RENAME TO "Depletion";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
