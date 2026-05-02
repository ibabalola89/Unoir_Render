-- Add original Shopify media alt text for SEO/a11y carry-over on publish.
ALTER TABLE "ProcessedImage" ADD COLUMN "shopifyAltText" TEXT;
