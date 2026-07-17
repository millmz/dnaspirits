-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExWorksSale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importerId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "invoiceNumber" TEXT NOT NULL DEFAULT '',
    "invoiceStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "paidDate" DATETIME,
    "notes" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ExWorksSale_importerId_fkey" FOREIGN KEY ("importerId") REFERENCES "Importer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExWorksSale_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ExWorksSale" ("date", "id", "importerId", "invoiceNumber", "invoiceStatus", "notes", "paidDate", "status", "warehouseId") SELECT "date", "id", "importerId", "invoiceNumber", "invoiceStatus", "notes", "paidDate", "status", "warehouseId" FROM "ExWorksSale";
DROP TABLE "ExWorksSale";
ALTER TABLE "new_ExWorksSale" RENAME TO "ExWorksSale";
CREATE TABLE "new_SocialPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'INSTAGRAM',
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT NOT NULL DEFAULT '',
    "assetUrl" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'IDEA',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "igChildIds" TEXT NOT NULL DEFAULT '',
    "igCreationId" TEXT NOT NULL DEFAULT '',
    "igMediaId" TEXT NOT NULL DEFAULT '',
    "igPermalink" TEXT NOT NULL DEFAULT '',
    "fbPostId" TEXT NOT NULL DEFAULT '',
    "publishedAt" DATETIME,
    "publishError" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_SocialPost" ("approved", "assetUrl", "autoPublish", "caption", "channel", "createdAt", "date", "fbPostId", "hashtags", "id", "igChildIds", "igCreationId", "igMediaId", "notes", "publishError", "publishedAt", "source", "status", "title") SELECT "approved", "assetUrl", "autoPublish", "caption", "channel", "createdAt", "date", "fbPostId", "hashtags", "id", "igChildIds", "igCreationId", "igMediaId", "notes", "publishError", "publishedAt", "source", "status", "title" FROM "SocialPost";
DROP TABLE "SocialPost";
ALTER TABLE "new_SocialPost" RENAME TO "SocialPost";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "id", "name", "passwordHash", "role") SELECT "createdAt", "email", "id", "name", "passwordHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
