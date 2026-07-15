-- CreateTable
CREATE TABLE "QboConnection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "realmId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessExpiresAt" DATETIME NOT NULL,
    "refreshExpiresAt" DATETIME,
    "lastSyncAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
