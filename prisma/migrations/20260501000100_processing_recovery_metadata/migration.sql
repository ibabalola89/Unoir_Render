-- Durable observability for stuck-job recovery.
ALTER TABLE "ProcessedImage" ADD COLUMN "processingStartedAt" DATETIME;
ALTER TABLE "ProcessedImage" ADD COLUMN "recoveryAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProcessedImage" ADD COLUMN "lastRecoveryAt" DATETIME;
ALTER TABLE "ProcessedImage" ADD COLUMN "recoveryReason" TEXT;

CREATE INDEX "ProcessedImage_status_processingStartedAt_idx" ON "ProcessedImage"("status", "processingStartedAt");