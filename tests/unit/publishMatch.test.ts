import { describe, expect, it } from "vitest";
import {
    altTextWithPublishStamp,
    matchAppAddedMedia,
    matchMediaByProcessedKey,
    publishAttemptMayHaveCreated,
    publishStampForImage,
    ShopifyPublishRejectedError,
} from "../../lib/shopify/publish";
import { ShopifyGraphqlThrottledError } from "../../lib/shopify/retry";

const processedKey = "processed/job_1/img_1.jpg";

describe("matchMediaByProcessedKey", () => {
    it("reuses the one gallery image whose source still contains the processed key", () => {
        expect(matchMediaByProcessedKey([
            { id: "gid://shopify/MediaImage/1", sourceUrl: "https://cdn.shopify.com/original.jpg" },
            {
                id: "gid://shopify/MediaImage/2",
                sourceUrl: `https://cdn.example/${processedKey}?v=1`,
            },
        ], processedKey)).toEqual({ kind: "found", mediaId: "gid://shopify/MediaImage/2" });
    });

    it("returns none when no source contains the processed key", () => {
        expect(matchMediaByProcessedKey([
            { id: "gid://shopify/MediaImage/1", sourceUrl: "https://cdn.shopify.com/files/image.jpg" },
        ], processedKey)).toEqual({ kind: "none" });
    });

    it("does not guess when more than one source contains the processed key", () => {
        expect(matchMediaByProcessedKey([
            { id: "gid://shopify/MediaImage/1", sourceUrl: `https://cdn.example/${processedKey}` },
            { id: "gid://shopify/MediaImage/2", sourceUrl: `https://cdn.example/${processedKey}?v=2` },
        ], processedKey)).toEqual({ kind: "ambiguous" });
    });
});

describe("publish stamp", () => {
    const stamp = publishStampForImage("img_1");

    it("appends the stamp without replacing a merchant alt", () => {
        expect(altTextWithPublishStamp("Linen shirt, front", stamp)).toBe(`Linen shirt, front ${stamp}`);
    });

    it("uses the stamp alone when the merchant alt is empty", () => {
        expect(altTextWithPublishStamp(null, stamp)).toBe(stamp);
        expect(altTextWithPublishStamp(`already ${stamp}`, stamp)).toBe(`already ${stamp}`);
    });

    it("keeps the stamp when the merchant alt is longer than Shopify allows", () => {
        const merchantAlt = "word ".repeat(200);
        const alt = altTextWithPublishStamp(merchantAlt, stamp);
        expect(alt.endsWith(stamp)).toBe(true);
        expect(alt.length).toBeLessThanOrEqual(512);
        expect(alt.startsWith("word")).toBe(true);
    });

    it("reuses the stamped file after Shopify replaces the source URL", () => {
        expect(matchAppAddedMedia([
            {
                id: "gid://shopify/MediaImage/original",
                sourceUrl: "https://cdn.shopify.com/s/files/original.jpg",
                alt: "Linen shirt, front",
            },
            {
                id: "gid://shopify/MediaImage/published",
                sourceUrl: "https://cdn.shopify.com/s/files/1/cdn-copy.jpg",
                alt: `Linen shirt, front ${stamp}`,
            },
        ], { processedKey, publishStamp: stamp })).toEqual({
            kind: "found",
            mediaId: "gid://shopify/MediaImage/published",
        });
    });

    it("does not match the original product media id, position, or merchant alt alone", () => {
        expect(matchAppAddedMedia([
            {
                id: "gid://shopify/MediaImage/original",
                sourceUrl: "https://cdn.shopify.com/s/files/original.jpg",
                alt: "Linen shirt, front",
            },
        ], { processedKey, publishStamp: stamp })).toEqual({ kind: "none" });
    });

    it("does not guess when the stamp and the processed key point at different files", () => {
        expect(matchAppAddedMedia([
            {
                id: "gid://shopify/MediaImage/1",
                sourceUrl: `https://cdn.example/${processedKey}`,
                alt: "front",
            },
            {
                id: "gid://shopify/MediaImage/2",
                sourceUrl: "https://cdn.shopify.com/s/files/cdn-copy.jpg",
                alt: stamp,
            },
        ], { processedKey, publishStamp: stamp })).toEqual({ kind: "ambiguous" });
    });

    it("treats a Shopify rejection as safe to retry and a dropped call as unknown", () => {
        expect(publishAttemptMayHaveCreated(new ShopifyPublishRejectedError("no"))).toBe(false);
        expect(publishAttemptMayHaveCreated(new ShopifyGraphqlThrottledError())).toBe(false);
        expect(publishAttemptMayHaveCreated(new Error("network"))).toBe(true);
    });
});
