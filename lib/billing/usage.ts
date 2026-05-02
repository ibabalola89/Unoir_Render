/**
 * Billing usage helpers (Phase 6).
 *
 * "Usage" = count of `ProcessedImage` rows for this shop, in the current
 * calendar month (UTC), whose status reflects a *consumed* remove.bg credit.
 *
 * Statuses that count: anything not listed in NON_COUNTING_STATUSES. Pending
 * and processing rows intentionally reserve quota at enqueue time.
 * Statuses that do NOT count: failed, canceled.
 *
 * Quotas are hardcoded per V1 scope (Free=20, Starter=500). See plans.ts.
 */

import prisma from "../../app/db.server";
import {
    FREE_PLAN,
    PLAN_QUOTAS,
    STARTER_PLAN,
    type PlanName,
} from "./plans";

/** Minimal subset of Prisma client used here — accepts the base client or a transactional one. */
type UsageClient = Pick<typeof prisma, "processedImage">;

/**
 * Statuses that do NOT count toward usage. Everything else (pending,
 * processing, processed, approved, rejected, published) is counted as a
 * consumed credit — `pending`/`processing` matter because we need to lock in
 * the quota at enqueue time, not after bg-removal completes (otherwise a
 * merchant can queue 20 + 20 in quick succession and overshoot).
 */
export const NON_COUNTING_STATUSES = ["failed", "canceled"];

function startOfMonthUTC(now = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getMonthlyUsage(
    shop: string,
    client: UsageClient = prisma,
): Promise<number> {
    return client.processedImage.count({
        where: {
            job: { shop },
            status: { notIn: NON_COUNTING_STATUSES },
            createdAt: { gte: startOfMonthUTC() },
        },
    });
}

export interface UsageSummary {
    plan: PlanName;
    quota: number;
    used: number;
    remaining: number;
}

/**
 * Resolve the active Shopify Billing plan.
 *
 * Fail-closed: if the Shopify Billing API is unavailable we throw
 * `BillingCheckUnavailableError` rather than silently treating the merchant
 * as Free (which would either downgrade a paying merchant or — worse —
 * let usage be charged against the wrong quota during an outage).
 *
 * One quick retry on failure handles transient blips. Loaders/actions that
 * call this MUST handle the thrown error (typically: render a "billing check
 * unavailable, try again" banner and refuse to enqueue work).
 */
export class BillingCheckUnavailableError extends Error {
    constructor(cause?: unknown) {
        super("Shopify Billing API unavailable");
        this.name = "BillingCheckUnavailableError";
        if (cause) (this as { cause?: unknown }).cause = cause;
    }
}

export async function resolveActivePlan(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    billing: { check: (opts: any) => Promise<{ hasActivePayment: boolean }> },
): Promise<PlanName> {
    const opts = {
        plans: [STARTER_PLAN],
        isTest: process.env.NODE_ENV !== "production",
    };
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const check = await billing.check(opts);
            return check.hasActivePayment ? STARTER_PLAN : FREE_PLAN;
        } catch (err) {
            lastErr = err;
            // Brief backoff before second attempt only — don't sleep before throwing.
            if (attempt === 0) await new Promise((r) => setTimeout(r, 250));
        }
    }
    throw new BillingCheckUnavailableError(lastErr);
}

export async function getUsageSummary(
    shop: string,
    plan: PlanName,
): Promise<UsageSummary> {
    const used = await getMonthlyUsage(shop);
    const quota = PLAN_QUOTAS[plan];
    return { plan, quota, used, remaining: Math.max(0, quota - used) };
}

/**
 * Loader-friendly wrapper. Returns `{ ok: false }` when the Billing API is
 * unavailable so the page can render a banner instead of crashing. Use the
 * strict `resolveActivePlan` in **action** code paths that must fail closed
 * (e.g. enqueuing work).
 */
export async function tryGetUsageSummary(
    shop: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    billing: { check: (opts: any) => Promise<{ hasActivePayment: boolean }> },
): Promise<
    | { ok: true; summary: UsageSummary }
    | { ok: false; reason: "billing-unavailable" }
> {
    try {
        const plan = await resolveActivePlan(billing);
        const summary = await getUsageSummary(shop, plan);
        return { ok: true, summary };
    } catch (err) {
        if (err instanceof BillingCheckUnavailableError) {
            return { ok: false, reason: "billing-unavailable" };
        }
        throw err;
    }
}
