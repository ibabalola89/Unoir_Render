-- Set when a worker is about to call remove.bg. Recovery uses it to avoid a second call.
ALTER TABLE "ProcessedImage" ADD COLUMN "providerStartedAt" DATETIME;
