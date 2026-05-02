import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkRemoveBgAccount } from "@lib/ai/removeBg";
import {
    DEFAULT_BACKGROUND_ID,
    isBackgroundAvailableForPlan,
    toBackgroundId,
} from "@lib/backgrounds";
import { checkBgRemovalWorker, enqueueBgRemoval } from "@lib/queue";
import { MAX_IMAGES_PER_JOB } from "@lib/queue/constants";
import {
    fetchMediaSourceMetadata,
    fetchProductMediaOwnership,
    isEligibleSourceUrl,
} from "@lib/shopify/products";
import { PLAN_QUOTAS } from "@lib/billing/plans";
import {
    BillingCheckUnavailableError,
    getMonthlyUsage,
    resolveActivePlan,
} from "@lib/billing/usage";
import { checkStorageBucket } from "@lib/storage";
import { emitTelemetryEvent, serializeError } from "@lib/telemetry";

/**
 * Process route is action-only. GET → bounce to picker.
 *
 * The picker POSTs two parallel arrays (`imageIds`, `productIds`).
 * Image source URLs are resolved server-side via Admin GraphQL — never trusted
 * from the form (SSRF guard + cross-shop safety).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return redirect("/app/picker");
};

function isMediaImageGid(value: string): boolean {
    return /^gid:\/\/shopify\/MediaImage\/[\w.-]+$/.test(value);
}
function isProductGid(value: string): boolean {
    return /^gid:\/\/shopify\/Product\/[\w.-]+$/.test(value);
}

function toIdempotencyKey(value: FormDataEntryValue | null): string | null {
    const raw = String(value ?? "");
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
        ? raw
        : null;
}

class QuotaRaceError extends Error {
    constructor(public used: number, public quota: number) {
        super("quota exceeded by concurrent submit");
        this.name = "QuotaRaceError";
    }
}

class RateLimitRaceError extends Error {
    constructor(public retryAt: Date) {
        super("shop job creation rate limit exceeded");
        this.name = "RateLimitRaceError";
    }
}

/**
 * Per-shop job-creation rate limit (sliding 1h window). Default 5/h is a
 * blunt anti-abuse guard for prod; dev overrides via PROCESS_JOBS_PER_HOUR
 * to avoid throttling during manual smoke tests. Canceled jobs are excluded
 * from the count — cancelling and retrying should not consume the budget.
 */
const PROCESS_JOBS_PER_HOUR = (() => {
    const raw = process.env.PROCESS_JOBS_PER_HOUR;
    if (!raw) return 5;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 5;
})();

/** SQLite serializes txns at the connection level; setting isolationLevel throws. */
function isSqlite(): boolean {
    const url = process.env.DATABASE_URL ?? "";
    return url.startsWith("file:") || url.startsWith("sqlite:");
}

class ProcessingDependencyError extends Error {
    constructor(public readonly reason: "provider" | "storage" | "worker") {
        super(`processing dependency unavailable: ${reason}`);
        this.name = "ProcessingDependencyError";
    }
}

async function assertProcessingReady(): Promise<void> {
    const checks = await Promise.allSettled([
        checkRemoveBgAccount(),
        checkStorageBucket(),
        checkBgRemovalWorker(),
    ]);
    const [removeBg, storage, worker] = checks;
    if (removeBg.status === "rejected") throw new ProcessingDependencyError("provider");
    if (storage.status === "rejected") throw new ProcessingDependencyError("storage");
    if (worker.status === "rejected") throw new ProcessingDependencyError("worker");
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session, billing } = await authenticate.admin(request);
    const form = await request.formData();

    const imageIds = form.getAll("imageIds").map(String);
    const productIds = form.getAll("productIds").map(String);
    const idempotencyKey = toIdempotencyKey(form.get("idempotencyKey"));

    const backgroundRaw = String(form.get("background") ?? DEFAULT_BACKGROUND_ID);
    const background = toBackgroundId(backgroundRaw);
    if (!background) {
        throw redirect("/app/picker?error=invalid-background");
    }

    if (imageIds.length === 0 || imageIds.length !== productIds.length) {
        throw redirect("/app/picker?error=empty");
    }
    if (imageIds.length > MAX_IMAGES_PER_JOB) {
        throw redirect("/app/picker?error=cap");
    }

    // Validate + dedupe (mediaId, productId) pairs FIRST so quota / rate
    // counting uses the post-dedupe count. A merchant submitting [A, A, B]
    // should consume 2 of quota, not 3.
    const seen = new Set<string>();
    const pairs: Array<{ mediaId: string; productId: string }> = [];
    for (let i = 0; i < imageIds.length; i++) {
        const mediaId = imageIds[i];
        const productId = productIds[i];
        if (!isMediaImageGid(mediaId) || !isProductGid(productId)) {
            throw redirect("/app/picker?error=invalid");
        }
        if (seen.has(mediaId)) continue;
        seen.add(mediaId);
        pairs.push({ mediaId, productId });
    }
    if (pairs.length === 0) {
        throw redirect("/app/picker?error=empty");
    }

    // Quota gate. Free=20/mo, Starter=500/mo. Block before we burn remove.bg
    // credits or write any rows. Fail closed: if the Billing API is down we
    // refuse the job rather than guess the merchant's plan.
    let plan;
    try {
        plan = await resolveActivePlan(billing);
    } catch (err) {
        if (err instanceof BillingCheckUnavailableError) {
            emitTelemetryEvent("billing_check_unavailable", {
                shop: session.shop,
                route: "process",
                ...serializeError(err),
            }, "warn");
            throw redirect("/app/picker?error=billing-unavailable");
        }
        throw err;
    }
    const quota = PLAN_QUOTAS[plan];
    if (!isBackgroundAvailableForPlan(background, plan)) {
        throw redirect(`/app/picker?error=finish-plan&background=${encodeURIComponent(background)}`);
    }
    // Pre-flight quota check (cheap, gives merchant a fast error response).
    // The authoritative re-check happens inside the transaction below to
    // close the concurrent-submit race window.
    const usedPreflight = await getMonthlyUsage(session.shop);
    if (usedPreflight + pairs.length > quota) {
        emitTelemetryEvent("quota_exhausted", {
            shop: session.shop,
            plan,
            quota,
            used: usedPreflight,
            requested: pairs.length,
        }, "warn");
        throw redirect(`/app/picker?error=quota&used=${usedPreflight}&quota=${quota}`);
    }
    const rateWindowStart = new Date(Date.now() - 60 * 60 * 1000);
    const jobsThisHour = await prisma.processingJob.count({
        where: {
            shop: session.shop,
            createdAt: { gte: rateWindowStart },
            status: { not: "canceled" },
        },
    });
    if (jobsThisHour >= PROCESS_JOBS_PER_HOUR) {
        emitTelemetryEvent("process_rate_limited", {
            shop: session.shop,
            jobsThisHour,
            limit: PROCESS_JOBS_PER_HOUR,
        }, "warn");
        throw redirect("/app/picker?error=rate-limit");
    }

    try {
        await assertProcessingReady();
    } catch (err) {
        if (err instanceof ProcessingDependencyError) {
            emitTelemetryEvent("processing_dependency_unavailable", {
                shop: session.shop,
                dependency: err.reason,
                ...serializeError(err),
            }, "error");
            throw redirect(`/app/picker?error=${err.reason}-unavailable`);
        }
        throw err;
    }

    // Resolve canonical source URLs server-side. Admin GraphQL is shop-scoped,
    // so any GID not owned by this shop simply won't appear in the result.
    let sources: Awaited<ReturnType<typeof fetchMediaSourceMetadata>>;
    let ownership: Awaited<ReturnType<typeof fetchProductMediaOwnership>>;
    try {
        [sources, ownership] = await Promise.all([
            fetchMediaSourceMetadata(
                admin,
                pairs.map((p) => p.mediaId),
            ),
            fetchProductMediaOwnership(
                admin,
                pairs.map((p) => p.productId),
            ),
        ]);
    } catch {
        // Throttle exhaustion / 5xx / network. Tell the merchant to retry
        // instead of dropping a 500.
        emitTelemetryEvent("shopify_media_lookup_unavailable", {
            shop: session.shop,
            requested: pairs.length,
        }, "error");
        throw redirect("/app/picker?error=shopify-unavailable");
    }
    if (!pairs.every((p) => ownership.get(p.productId)?.has(p.mediaId))) {
        throw redirect("/app/picker?error=invalid");
    }
    const triplets = pairs
        .map((p) => ({ ...p, source: sources.get(p.mediaId) }))
        .filter((p): p is { mediaId: string; productId: string; source: NonNullable<typeof p.source> } =>
            Boolean(p.source?.sourceUrl),
        )
        // Re-enforce JPG/PNG-only at the API boundary. The picker UI hides
        // ineligible images, but a hand-crafted POST could still get past
        // GID validation. remove.bg also rejects WebP/AVIF/etc., so failing
        // here saves a worker round-trip and a credit.
        .filter((p) => isEligibleSourceUrl(p.source.sourceUrl));

    if (triplets.length === 0) {
        throw redirect("/app/picker?error=invalid");
    }
    if (triplets.length !== pairs.length) {
        throw redirect("/app/picker?error=invalid-format");
    }

    // Atomic quota+create. Recount usage inside the transaction so two
    // simultaneous submits at 19/20 each can't both win. On Postgres this
    // requires Serializable; on SQLite (dev) the connection-level lock is
    // sufficient. The transaction throws `quotaExceeded` to roll back if a
    // racing job slipped in between the pre-flight check and now.
    let job;
    try {
        job = await prisma.$transaction(async (tx) => {
            const usedNow = await getMonthlyUsage(session.shop, tx);
            if (usedNow + triplets.length > quota) {
                throw new QuotaRaceError(usedNow, quota);
            }
            const recentJobs = await tx.processingJob.count({
                where: {
                    shop: session.shop,
                    createdAt: { gte: rateWindowStart },
                    status: { not: "canceled" },
                },
            });
            if (recentJobs >= PROCESS_JOBS_PER_HOUR) {
                throw new RateLimitRaceError(new Date(rateWindowStart.getTime() + 60 * 60 * 1000));
            }
            return tx.processingJob.create({
                data: {
                    shop: session.shop,
                    status: "queued",
                    background,
                    totalImages: triplets.length,
                    idempotencyKey,
                    images: {
                        create: triplets.map((t) => ({
                            shopifyMediaId: t.mediaId,
                            shopifyProductId: t.productId,
                            shopifyAltText: t.source.altText,
                            originalUrl: t.source.sourceUrl,
                            status: "pending",
                        })),
                    },
                },
                include: { images: true },
            });
        }, isSqlite() ? undefined : { isolationLevel: "Serializable" });
    } catch (err) {
        if (err instanceof QuotaRaceError) {
            emitTelemetryEvent("quota_race_blocked", {
                shop: session.shop,
                plan,
                quota: err.quota,
                used: err.used,
                requested: triplets.length,
            }, "warn");
            throw redirect(`/app/picker?error=quota&used=${err.used}&quota=${err.quota}`);
        }
        if (err instanceof RateLimitRaceError) {
            emitTelemetryEvent("process_rate_limit_race_blocked", {
                shop: session.shop,
                retryAt: err.retryAt,
            }, "warn");
            throw redirect(`/app/picker?error=rate-limit&retryAt=${err.retryAt.toISOString()}`);
        }
        if (
            idempotencyKey &&
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
        ) {
            const existing = await prisma.processingJob.findFirst({
                where: { shop: session.shop, idempotencyKey },
                select: { id: true },
            });
            if (existing) {
                emitTelemetryEvent("process_duplicate_submit_reused", {
                    shop: session.shop,
                    jobId: existing.id,
                }, "info");
                return redirect(`/app/jobs/${existing.id}`);
            }
        }
        throw err;
    }

    try {
        await Promise.all(
            job.images.map((image) =>
                enqueueBgRemoval({
                    jobId: job.id,
                    imageId: image.id,
                    shop: session.shop,
                    background,
                    sourceUrl: image.originalUrl,
                    shopifyMediaId: image.shopifyMediaId,
                }),
            ),
        );
    } catch (err) {
        // Redis down or BullMQ rejection. Mark the job failed so it doesn't
        // sit forever as `queued` with no workers picking it up. Best-effort:
        // if the cleanup itself fails we still surface the original error.
        await prisma.processingJob
            .update({
                where: { id: job.id },
                data: { status: "failed" },
            })
            .catch(() => undefined);
        await prisma.processedImage
            .updateMany({
                where: { jobId: job.id, status: "pending" },
                data: {
                    status: "failed",
                    errorMessage: "queue unavailable at enqueue time",
                },
            })
            .catch(() => undefined);
        // Don't leak Redis/BullMQ internals into the redirect URL — browser
        // history and access logs would capture them. Generic merchant copy
        // only; raw error stays in the server logs.
        console.error(
            `[process] enqueue failed for job=${job.id}:`,
            err instanceof Error ? err.message : String(err),
        );
        emitTelemetryEvent("queue_enqueue_failed", {
            shop: session.shop,
            jobId: job.id,
            imageCount: job.images.length,
            ...serializeError(err),
        }, "error");
        throw redirect(`/app/picker?error=queue-unavailable`);
    }

    return redirect(`/app/jobs/${job.id}`);
};
