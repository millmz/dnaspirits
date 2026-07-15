-- CreateTable
CREATE TABLE "SkuDepletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "cases" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'REPORT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkuDepletion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChainVolume" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "ytdCases" REAL NOT NULL,
    "ytdCasesLY" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChainVolume_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "Importer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
