import { describe, expect, it } from "vitest";
import { isOpsShopAllowed, parseOpsShopAllowlist } from "../../lib/ops/access";

describe("ops dashboard access", () => {
    it("parses comma-separated shop allowlists", () => {
        const allowlist = parseOpsShopAllowlist("admin.myshopify.com, Beta-Shop.myshopify.com ");
        expect([...allowlist.shops]).toEqual([
            "admin.myshopify.com",
            "beta-shop.myshopify.com",
        ]);
        expect(allowlist.invalid).toEqual([]);
    });

    it("reports malformed allowlist entries", () => {
        expect(parseOpsShopAllowlist("admin.myshopify.com, *")).toMatchObject({
            invalid: ["*"],
        });
    });

    it("allows configured internal shops", () => {
        expect(
            isOpsShopAllowed("ADMIN.myshopify.com", {
                NODE_ENV: "production",
                INTERNAL_OPS_SHOPS: "admin.myshopify.com",
            }),
        ).toBe(true);
    });

    it("blocks unlisted shops in production", () => {
        expect(
            isOpsShopAllowed("merchant.myshopify.com", {
                NODE_ENV: "production",
                INTERNAL_OPS_SHOPS: "admin.myshopify.com",
            }),
        ).toBe(false);
    });

    it("fails closed in production when the allowlist is empty", () => {
        expect(isOpsShopAllowed("admin.myshopify.com", { NODE_ENV: "production" })).toBe(false);
    });

    it("fails closed when the allowlist contains malformed entries", () => {
        expect(
            isOpsShopAllowed("admin.myshopify.com", {
                NODE_ENV: "production",
                INTERNAL_OPS_SHOPS: "admin.myshopify.com,*",
            }),
        ).toBe(false);
    });

    it("requires an explicit allowlist in development", () => {
        expect(isOpsShopAllowed("dev.myshopify.com", { NODE_ENV: "development" })).toBe(false);
        expect(
            isOpsShopAllowed("dev.myshopify.com", {
                NODE_ENV: "development",
                INTERNAL_OPS_SHOPS: "dev.myshopify.com",
            }),
        ).toBe(true);
    });
});
