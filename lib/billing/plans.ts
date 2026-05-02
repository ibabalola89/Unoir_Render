/**
 * Shopify Billing API — Phase 1 plumbing only.
 *
 * V1 plans (hardcoded; do NOT add Growth/Pro until retention is proven):
 *   - Free: 20 premium exports, White + Transparent finishes (no charge, gate via app logic)
 *   - Starter: 500 premium exports, editorial finishes, 7-day trial, recurring monthly
 *
 * Wired in `app/shopify.server.ts` via the `billing` config.
 */

import { BillingInterval } from "@shopify/shopify-app-remix/server";

export const FREE_PLAN = "Free" as const;
export const STARTER_PLAN = "Starter" as const;

export type PlanName = typeof FREE_PLAN | typeof STARTER_PLAN;

export const PLAN_QUOTAS: Record<PlanName, number> = {
    [FREE_PLAN]: 20,
    [STARTER_PLAN]: 500,
};

export const STARTER_PRICE_USD = 79.99;
export const STARTER_TRIAL_DAYS = 7;

/**
 * Free plan is gated in app code (not via Shopify Billing).
 * Only Starter is registered with Shopify Billing.
 */
export const billingConfig = {
    [STARTER_PLAN]: {
        trialDays: STARTER_TRIAL_DAYS,
        lineItems: [
            {
                amount: STARTER_PRICE_USD,
                currencyCode: "USD",
                interval: BillingInterval.Every30Days as const,
            },
        ],
    },
};
