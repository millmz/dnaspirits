-- CreateTable
CREATE TABLE "CapTableEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "member" TEXT NOT NULL,
    "unitType" TEXT NOT NULL DEFAULT 'ECONOMIC',
    "units" REAL NOT NULL,
    "dateAcquired" DATETIME,
    "round" TEXT NOT NULL DEFAULT '',
    "capitalCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "LegalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "title" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "jurisdiction" TEXT NOT NULL DEFAULT '',
    "executed" DATETIME,
    "dueDate" DATETIME,
    "link" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT ''
);
