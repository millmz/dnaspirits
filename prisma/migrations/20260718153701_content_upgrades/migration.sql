-- CreateTable
CREATE TABLE "PostSeries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "time" TEXT NOT NULL DEFAULT '09:00',
    "channel" TEXT NOT NULL DEFAULT 'IG_FB',
    "titleTemplate" TEXT NOT NULL,
    "captionTemplate" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT NOT NULL DEFAULT '',
    "weeksAhead" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AccountMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "profileViews" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    "storage" TEXT NOT NULL DEFAULT 'disk',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaAsset_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MediaAsset" ("bytes", "createdAt", "filename", "id", "mime", "position", "postId") SELECT "bytes", "createdAt", "filename", "id", "mime", "position", "postId" FROM "MediaAsset";
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
    "format" TEXT NOT NULL DEFAULT 'FEED',
    "firstComment" TEXT NOT NULL DEFAULT '',
    "unscheduled" BOOLEAN NOT NULL DEFAULT false,
    "seriesId" TEXT NOT NULL DEFAULT '',
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
INSERT INTO "new_SocialPost" ("approved", "assetUrl", "autoPublish", "caption", "channel", "createdAt", "date", "fbPostId", "hashtags", "id", "igChildIds", "igCreationId", "igMediaId", "igPermalink", "notes", "publishError", "publishedAt", "source", "status", "title") SELECT "approved", "assetUrl", "autoPublish", "caption", "channel", "createdAt", "date", "fbPostId", "hashtags", "id", "igChildIds", "igCreationId", "igMediaId", "igPermalink", "notes", "publishError", "publishedAt", "source", "status", "title" FROM "SocialPost";
DROP TABLE "SocialPost";
ALTER TABLE "new_SocialPost" RENAME TO "SocialPost";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AccountMetric_platform_fetchedAt_idx" ON "AccountMetric"("platform", "fetchedAt");
