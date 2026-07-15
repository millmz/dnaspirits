-- CreateTable
CREATE TABLE "Chargeback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importerId" TEXT NOT NULL,
    "saleId" TEXT,
    "date" DATETIME NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Chargeback_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "Importer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Chargeback_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "ExWorksSale" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
