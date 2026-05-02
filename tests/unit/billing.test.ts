import { describe, it, expect, vi } from "vitest";
import {
    BillingCheckUnavailableError,
    resolveActivePlan,
} from "../../lib/billing/usage";
import {
    billingConfig,
    FREE_PLAN,
    PLAN_QUOTAS,
    STARTER_PLAN,
    STARTER_PRICE_USD,
    STARTER_TRIAL_DAYS,
} from "../../lib/billing/plans";
import { getPremiumExportCapacity } from "../../lib/billing/capacity";

describe("V1 billing plans", () => {
    it("keeps Free constrained and Starter premium", () => {
        expect(PLAN_QUOTAS[FREE_PLAN]).toBe(20);
        expect(PLAN_QUOTAS[STARTER_PLAN]).toBe(500);
        expect(STARTER_PRICE_USD).toBe(79.99);
        expect(STARTER_TRIAL_DAYS).toBe(7);
        expect(billingConfig[STARTER_PLAN].lineItems[0].amount).toBe(79.99);
        expect(billingConfig[STARTER_PLAN].trialDays).toBe(7);
    });
});

describe("resolveActivePlan", () => {
    it("returns Starter when Shopify reports an active payment", async () => {
        const billing = { check: vi.fn().mockResolvedValue({ hasActivePayment: true }) };
        await expect(resolveActivePlan(billing)).resolves.toBe(STARTER_PLAN);
    });

    it("returns Free when no active payment", async () => {
        const billing = { check: vi.fn().mockResolvedValue({ hasActivePayment: false }) };
        await expect(resolveActivePlan(billing)).resolves.toBe(FREE_PLAN);
    });

    it("retries once on failure, then succeeds", async () => {
        const billing = {
            check: vi
                .fn()
                .mockRejectedValueOnce(new Error("network"))
                .mockResolvedValueOnce({ hasActivePayment: true }),
        };
        await expect(resolveActivePlan(billing)).resolves.toBe(STARTER_PLAN);
        expect(billing.check).toHaveBeenCalledTimes(2);
    });

    it("throws BillingCheckUnavailableError after both attempts fail", async () => {
        const billing = { check: vi.fn().mockRejectedValue(new Error("down")) };
        await expect(resolveActivePlan(billing)).rejects.toBeInstanceOf(
            BillingCheckUnavailableError,
        );
        expect(billing.check).toHaveBeenCalledTimes(2);
    });
});

describe("getPremiumExportCapacity", () => {
    it("keeps normal capacity available below 80%", () => {
        expect(
            getPremiumExportCapacity({ plan: STARTER_PLAN, quota: 500, used: 390, remaining: 110 }),
        ).toMatchObject({ state: "available", percentUsed: 78 });
    });

    it("warns when premium export capacity reaches 80%", () => {
        expect(
            getPremiumExportCapacity({ plan: STARTER_PLAN, quota: 500, used: 400, remaining: 100 }),
        ).toMatchObject({ state: "approaching", percentUsed: 80 });
    });

    it("escalates when premium export capacity reaches 90%", () => {
        expect(
            getPremiumExportCapacity({ plan: STARTER_PLAN, quota: 500, used: 450, remaining: 50 }),
        ).toMatchObject({ state: "low", percentUsed: 90 });
    });

    it("marks capacity exhausted at 100%", () => {
        expect(
            getPremiumExportCapacity({ plan: STARTER_PLAN, quota: 500, used: 500, remaining: 0 }),
        ).toMatchObject({ state: "exhausted", percentUsed: 100 });
    });
});
