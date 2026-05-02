-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "background" TEXT NOT NULL,
    "totalImages" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProcessedImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "shopifyMediaId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "processedUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "publishedMediaId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProcessedImage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProcessingJob_shop_createdAt_idx" ON "ProcessingJob"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessedImage_jobId_idx" ON "ProcessedImage"("jobId");

-- CreateIndex
CREATE INDEX "ProcessedImage_shopifyProductId_idx" ON "ProcessedImage"("shopifyProductId");
