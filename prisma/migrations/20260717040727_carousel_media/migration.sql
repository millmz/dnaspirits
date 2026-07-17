/*
  Warnings:

  - You are about to drop the column `mediaId` on the `SocialPost` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MediaAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "postId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaAsset_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- carry the old one-media-per-post link (SocialPost.mediaId) over to MediaAsset.postId
INSERT INTO "new_MediaAsset" ("bytes", "createdAt", "filename", "id", "mime", "postId")
SELECT m."bytes", m."createdAt", m."filename", m."id", m."mime",
       (SELECT sp."id" FROM "SocialPost" sp WHERE sp."mediaId" = m."id" LIMIT 1)
FROM "MediaAsset" m;
DROP TABLE "MediaAsset";
ALTER TABLE "new_MediaAsset" RENAME TO "MediaAsset";
CREATE INDEX "MediaAsset_postId_position_idx" ON "MediaAsset"("postId", "position");
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
    "fbPostId" TEXT NOT NULL DEFAULT '',
    "publishedAt" DATETIME,
    "publishError" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_SocialPost" ("approved", "assetUrl", "autoPublish", "caption", "channel", "createdAt", "date", "fbPostId", "hashtags", "id", "igCreationId", "igMediaId", "notes", "publishError", "publishedAt", "source", "status", "title") SELECT "approved", "assetUrl", "autoPublish", "caption", "channel", "createdAt", "date", "fbPostId", "hashtags", "id", "igCreationId", "igMediaId", "notes", "publishError", "publishedAt", "source", "status", "title" FROM "SocialPost";
DROP TABLE "SocialPost";
ALTER TABLE "new_SocialPost" RENAME TO "SocialPost";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
