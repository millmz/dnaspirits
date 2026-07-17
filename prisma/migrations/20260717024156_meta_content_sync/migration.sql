-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PostMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostMetric_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "mediaId" TEXT,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "igCreationId" TEXT NOT NULL DEFAULT '',
    "igMediaId" TEXT NOT NULL DEFAULT '',
    "fbPostId" TEXT NOT NULL DEFAULT '',
    "publishedAt" DATETIME,
    "publishError" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialPost_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SocialPost" ("approved", "assetUrl", "caption", "channel", "createdAt", "date", "hashtags", "id", "notes", "source", "status", "title") SELECT "approved", "assetUrl", "caption", "channel", "createdAt", "date", "hashtags", "id", "notes", "source", "status", "title" FROM "SocialPost";
DROP TABLE "SocialPost";
ALTER TABLE "new_SocialPost" RENAME TO "SocialPost";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PostMetric_postId_fetchedAt_idx" ON "PostMetric"("postId", "fetchedAt");
