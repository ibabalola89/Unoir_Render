-- Merchant confidence loop metadata.
-- completedAt gives the Jobs page a stable completion timestamp.
-- publishMode records whether published media was appended or promoted to primary.
ALTER TABLE "ProcessingJob" ADD COLUMN "completedAt" DATETIME;
ALTER TABLE "ProcessedImage" ADD COLUMN "publishMode" TEXT;