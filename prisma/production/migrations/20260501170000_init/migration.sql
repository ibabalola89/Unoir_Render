-- Production Postgres baseline for Unoir Studio.
-- Local development keeps the default SQLite schema/migrations.

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "background" TEXT NOT NULL,
    "totalImages" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessedImage" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "shopifyMediaId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyAltText" TEXT,
    "originalUrl" TEXT NOT NULL,
    "originalBackupKey" TEXT,
    "processedKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "recoveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastRecoveryAt" TIMESTAMP(3),
    "recoveryReason" TEXT,
    "publishedMediaId" TEXT,
    "publishMode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessedImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcessingJob_shop_createdAt_idx" ON "ProcessingJob"("shop", "createdAt");
CREATE UNIQUE INDEX "ProcessingJob_shop_idempotencyKey_key" ON "ProcessingJob"("shop", "idempotencyKey");
CREATE INDEX "ProcessedImage_jobId_idx" ON "ProcessedImage"("jobId");
CREATE INDEX "ProcessedImage_shopifyProductId_idx" ON "ProcessedImage"("shopifyProductId");
CREATE INDEX "ProcessedImage_status_processingStartedAt_idx" ON "ProcessedImage"("status", "processingStartedAt");

ALTER TABLE "ProcessedImage"
ADD CONSTRAINT "ProcessedImage_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "ProcessingJob"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
