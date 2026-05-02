/*
  Warnings:

  - You are about to drop the column `processedUrl` on the `ProcessedImage` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProcessedImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "shopifyMediaId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "originalBackupKey" TEXT,
    "processedKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "publishedMediaId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProcessedImage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProcessedImage" ("createdAt", "errorMessage", "id", "jobId", "originalUrl", "publishedMediaId", "shopifyMediaId", "shopifyProductId", "status", "updatedAt") SELECT "createdAt", "errorMessage", "id", "jobId", "originalUrl", "publishedMediaId", "shopifyMediaId", "shopifyProductId", "status", "updatedAt" FROM "ProcessedImage";
DROP TABLE "ProcessedImage";
ALTER TABLE "new_ProcessedImage" RENAME TO "ProcessedImage";
CREATE INDEX "ProcessedImage_jobId_idx" ON "ProcessedImage"("jobId");
CREATE INDEX "ProcessedImage_shopifyProductId_idx" ON "ProcessedImage"("shopifyProductId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
