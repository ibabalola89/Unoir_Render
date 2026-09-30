import { describe, expect, it } from "vitest";
import { matchMediaByProcessedKey } from "../../lib/shopify/publish";

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
