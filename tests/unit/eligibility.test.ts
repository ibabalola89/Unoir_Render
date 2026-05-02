import { describe, it, expect, vi } from "vitest";
import {
    chooseEligibleShopifyImageSource,
    fetchMediaSources,
    fetchProducts,
    isEligibleImage,
    isEligibleSourceUrl,
} from "../../lib/shopify/products";

function fakeAdmin(json: unknown) {
    return {
        graphql: vi.fn().mockResolvedValue({
            json: vi.fn().mockResolvedValue(json),
        }),
    } as unknown as Parameters<typeof fetchProducts>[0];
}

describe("isEligibleSourceUrl", () => {
    it("accepts JPG, JPEG, PNG (case-insensitive, with query strings)", () => {
        expect(isEligibleSourceUrl("https://cdn.shopify.com/x.jpg")).toBe(true);
        expect(isEligibleSourceUrl("https://cdn.shopify.com/x.JPEG")).toBe(true);
        expect(isEligibleSourceUrl("https://cdn.shopify.com/x.png?v=1")).toBe(true);
        expect(isEligibleSourceUrl("https://cdn.shopify.com/x.PNG#frag")).toBe(true);
    });

    it("rejects WebP, AVIF, GIF, etc.", () => {
        expect(isEligibleSourceUrl("https://cdn.shopify.com/x.webp")).toBe(false);
        expect(isEligibleSourceUrl("https://cdn.shopify.com/x.avif")).toBe(false);
        expect(isEligibleSourceUrl("https://cdn.shopify.com/x.gif")).toBe(false);
    });

    it("rejects URLs without an extension", () => {
        expect(isEligibleSourceUrl("https://cdn.shopify.com/foo")).toBe(false);
    });

    it("falls back to raw string when URL parsing fails", () => {
        expect(isEligibleSourceUrl("not a url but ends in .jpg")).toBe(true);
        expect(isEligibleSourceUrl("not a url and not a jpg")).toBe(false);
    });
});

describe("isEligibleImage", () => {
    it("prefers originalSource over the (possibly CDN-rewritten) url", () => {
        expect(
            isEligibleImage({
                id: "1",
                url: "https://cdn.shopify.com/x.webp",
                originalSource: "https://cdn.shopify.com/x.png",
                width: null,
                height: null,
                altText: null,
            }),
        ).toBe(true);
    });

    it("uses url when originalSource is missing", () => {
        expect(
            isEligibleImage({
                id: "1",
                url: "https://cdn.shopify.com/x.png",
                originalSource: null,
                width: null,
                height: null,
                altText: null,
            }),
        ).toBe(true);
    });
});

describe("chooseEligibleShopifyImageSource", () => {
    it("prefers eligible Shopify originalSource over a WebP display URL", () => {
        expect(
            chooseEligibleShopifyImageSource(
                "https://cdn.shopify.com/display.webp",
                "https://cdn.shopify.com/original.png",
            ),
        ).toBe("https://cdn.shopify.com/original.png");
    });

    it("rejects merchant-hosted originalSource even when it has an eligible extension", () => {
        expect(
            chooseEligibleShopifyImageSource(
                "https://cdn.shopify.com/display.webp",
                "https://example.com/original.png",
            ),
        ).toBeUndefined();
    });
});

describe("fetchProducts", () => {
    it("fetches up to the V1 per-job image cap per product", async () => {
        const admin = fakeAdmin({
            data: {
                products: {
                    edges: [],
                    pageInfo: {
                        hasNextPage: false,
                        hasPreviousPage: false,
                        startCursor: null,
                        endCursor: null,
                    },
                },
            },
        });

        await fetchProducts(admin);

        expect(vi.mocked(admin.graphql).mock.calls[0]?.[0]).toContain(
            "media(first: 50",
        );
    });
});

describe("fetchMediaSources", () => {
    it("returns the same eligible source the picker allowed", async () => {
        const admin = fakeAdmin({
            data: {
                nodes: [
                    {
                        id: "gid://shopify/MediaImage/1",
                        image: { url: "https://cdn.shopify.com/display.webp" },
                        originalSource: { url: "https://cdn.shopify.com/original.png" },
                    },
                ],
            },
        });

        const sources = await fetchMediaSources(admin, ["gid://shopify/MediaImage/1"]);

        expect(sources.get("gid://shopify/MediaImage/1")).toBe(
            "https://cdn.shopify.com/original.png",
        );
    });
});
