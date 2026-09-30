-- Durable publish stamp. Historical rows stay null and must not create another Shopify file.
ALTER TABLE "ProcessedImage" ADD COLUMN "publishStamp" TEXT;
ALTER TABLE "ProcessedImage" ADD COLUMN "publishCreateStartedAt" DATETIME;
