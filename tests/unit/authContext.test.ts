import { describe, expect, it } from "vitest";
import { redirectToEmbeddedAppUrl, shopFromAdminReferer } from "../../app/auth-context.server";

describe("embedded auth context recovery", () => {
    it("recovers the myshopify domain from an admin referer", () => {
        const request = new Request("https://localhost:3458/auth/login", {
            headers: {
                referer: "https://admin.shopify.com/store/unior-studio-dev/apps/unoir-studio/app/billing/subscribe",
            },
        });

        expect(shopFromAdminReferer(request)).toBe("unior-studio-dev.myshopify.com");
    });

    it("builds an embedded app redirect with the recovered shop", () => {
        const request = new Request("https://localhost:3458/auth/login", {
            headers: {
                referer: "https://admin.shopify.com/store/unior-studio-dev/apps/unoir-studio/app/billing/subscribe",
            },
        });

        expect(redirectToEmbeddedAppUrl(request, "/app/billing")).toBe(
            "/app/billing?shop=unior-studio-dev.myshopify.com",
        );
    });

    it("does not trust non-admin referers", () => {
        const request = new Request("https://localhost:3458/auth/login", {
            headers: { referer: "https://example.com/store/unior-studio-dev" },
        });

        expect(shopFromAdminReferer(request)).toBeNull();
    });
});