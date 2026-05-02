-- Add a nullable process-submit idempotency key. Multiple NULL values remain
-- allowed by SQLite/Postgres unique indexes, while real form keys are unique
-- per shop.
ALTER TABLE "ProcessingJob" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "ProcessingJob_shop_idempotencyKey_key" ON "ProcessingJob"("shop", "idempotencyKey");