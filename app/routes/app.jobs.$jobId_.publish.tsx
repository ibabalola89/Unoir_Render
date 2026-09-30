import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getPublishUrl } from "@lib/storage";
import {
    deletePublishedMedia,
    findExistingAppMedia,
    promoteMediaToPrimary,
    publishProcessedMedia,
    verifyMediaStatus,
} from "@lib/shopify/publish";
import { countStatuses, resolveSettledJobStatus, workflowLockClaimWhere } from "@lib/jobs/status";
import { emitTelemetryEvent, serializeError } from "@lib/telemetry";

/**
 * Publish action.
 *
 * POST /app/jobs/:jobId/publish
 *
 * State machine (per ProcessedImage):
 *   approved / failed_publish → call productCreateMedia → publishing
 *   publishing                → verify media ingest status:
 *                     READY      → published
 *                     FAILED     → failed_publish
 *                     PROCESSING → stay publishing (re-click Publish to re-verify)
 *   approved (on create error) → stay approved + errorMessage set
 *
 * Job status reconciliation:
 *   ≥1 published, 0 outstanding media states → published
 *   any publishing / failed_publish / mixed published rows → partially_published
 *   only approved create failures remaining → completed
 *
 * Re-clicking Publish is idempotent — `approved` rows retry create, `publishing`
 * rows are re-verified (no duplicate productCreateMedia call).
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return redirect(`/app/jobs/${params.jobId}/preview`);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const jobId = params.jobId;
    if (!jobId) throw new Response("Not found", { status: 404 });
    const form = await request.formData();
    const requestedPublishMode = String(form.get("publishMode") ?? "append");
    const publishMode = requestedPublishMode === "replace_primary"
        ? "replace_primary"
        : "append";

    // Verify ownership.
    const owned = await prisma.processingJob.findFirst({
        where: { id: jobId, shop: session.shop },
        select: { id: true },
    });
    if (!owned) throw new Response("Not found", { status: 404 });

    // Server-side review gate. A direct POST must not be able to publish while
    // processing is still active or while outputs are still unreviewed.
    const publishBlocked = await prisma.processedImage.count({
        where: { jobId, status: { in: ["pending", "processing", "processed"] } },
    });
    if (publishBlocked > 0) {
        return redirect(`/app/jobs/${jobId}/preview?error=unreviewed`);
    }

    const actionable = await prisma.processedImage.count({
        where: { jobId, status: { in: ["approved", "publishing", "failed_publish"] } },
    });
    if (actionable === 0) {
        return redirect(`/app/jobs/${jobId}/preview?error=nothing-approved`);
    }

    // Claim the parent as the in-flight mutex. Image rows decide what can
    // publish; a canceled or failed parent must still publish finished,
    // approved images. A fresh `publishing` lock is left alone. A lock older
    // than the stale window can be reclaimed after a crashed action.
    const claim = await prisma.processingJob.updateMany({
        where: workflowLockClaimWhere(jobId),
        data: { status: "publishing" },
    });
    if (claim.count === 0) {
        return redirect(`/app/jobs/${jobId}/preview?error=publish-in-progress`);
    }

    const job = await prisma.processingJob.findFirst({
        where: { id: jobId, shop: session.shop },
        include: {
            images: {
                where: { status: { in: ["approved", "publishing", "failed_publish"] } },
            },
        },
    });
    if (!job) throw new Response("Not found", { status: 404 });
    if (job.images.length === 0) {
        // Nothing to publish or verify. Reconcile status to whatever's accurate
        // given the remaining published / failed_publish rows.
        await reconcileJobStatus(jobId);
        return redirect(`/app/jobs/${jobId}/preview?error=nothing-approved`);
    }

    try {
        // Phase 1: create media for rows that need a new Shopify media object.
        // `failed_publish` rows are retryable; if a previous failed media id is
        // present, delete it best-effort before creating a replacement.
        const toCreate = job.images.filter(
            (i) => i.status === "approved" || i.status === "failed_publish",
        );
        const CONCURRENCY = 4;
        const createQueue = [...toCreate];
        const createWorkers = Array.from(
            { length: Math.min(CONCURRENCY, createQueue.length) },
            () =>
                (async () => {
                    while (createQueue.length > 0) {
                        const image = createQueue.shift();
                        if (!image) break;
                        if (!image.processedKey) {
                            await prisma.processedImage
                                .update({
                                    where: { id: image.id },
                                    data: { errorMessage: "no processed bytes to publish" },
                                })
                                .catch(() => undefined);
                            continue;
                        }
                        try {
                            // Id was stored before a later write failed. Do not create again.
                            if (image.publishedMediaId && image.status !== "failed_publish") {
                                await prisma.processedImage.update({
                                    where: { id: image.id },
                                    data: {
                                        status: "publishing",
                                        publishMode,
                                        errorMessage: null,
                                    },
                                });
                                continue;
                            }
                            if (image.status === "failed_publish" && image.publishedMediaId) {
                                try {
                                    await deletePublishedMedia(admin, {
                                        productId: image.shopifyProductId,
                                        mediaId: image.publishedMediaId,
                                    });
                                } catch (err) {
                                    const message = err instanceof Error ? err.message : String(err);
                                    await prisma.processedImage.update({
                                        where: { id: image.id },
                                        data: { errorMessage: message },
                                    });
                                    continue;
                                }
                                await prisma.processedImage.update({
                                    where: { id: image.id },
                                    data: { publishedMediaId: null },
                                });
                            }
                            const existing = await findExistingAppMedia(admin, {
                                productId: image.shopifyProductId,
                                processedKey: image.processedKey,
                            });
                            if (existing.kind === "ambiguous" || existing.kind === "incomplete") {
                                await prisma.processedImage.update({
                                    where: { id: image.id },
                                    data: {
                                        errorMessage: existing.kind === "ambiguous"
                                            ? "More than one Shopify image matches this result. Nothing new was published."
                                            : "Shopify's product gallery could not be fully checked, so nothing new was published.",
                                    },
                                });
                                continue;
                            }
                            let mediaId = existing.kind === "found" ? existing.mediaId : null;
                            if (!mediaId) {
                                const sourceUrl = await getPublishUrl(image.processedKey);
                                const result = await publishProcessedMedia(admin, {
                                    productId: image.shopifyProductId,
                                    sourceUrl,
                                    altText: image.shopifyAltText,
                                });
                                mediaId = result.mediaId;
                            }
                            // Persist the Shopify id before status or primary promotion.
                            await prisma.processedImage.update({
                                where: { id: image.id },
                                data: { publishedMediaId: mediaId },
                            });
                            await prisma.processedImage.update({
                                where: { id: image.id },
                                data: {
                                    status: "publishing",
                                    publishMode,
                                    errorMessage: null,
                                },
                            });
                        } catch (err) {
                            const message = err instanceof Error ? err.message : String(err);
                            emitTelemetryEvent("publish_create_failed", {
                                shop: session.shop,
                                jobId,
                                imageId: image.id,
                                productId: image.shopifyProductId,
                                publishMode,
                                ...serializeError(err),
                            }, "error");
                            await prisma.processedImage
                                .update({
                                    where: { id: image.id },
                                    data: { errorMessage: message },
                                })
                                .catch(() => undefined);
                        }
                    }
                })(),
        );
        await Promise.all(createWorkers);

        // Phase 2: verify ingest. Up to two passes with a short delay so that
        // most images flip READY before we return. Anything still PROCESSING
        // stays as `publishing` and feeds into `partially_published` job state;
        // re-clicking Publish will re-verify.
        for (let attempt = 0; attempt < 2; attempt++) {
            const pending = await prisma.processedImage.findMany({
                where: { jobId, status: "publishing", publishedMediaId: { not: null } },
                select: {
                    id: true,
                    publishedMediaId: true,
                    shopifyProductId: true,
                    publishMode: true,
                },
            });
            if (pending.length === 0) break;
            const idMap = new Map<string, string>(); // mediaId → imageId
            const productByMedia = new Map<string, string>(); // mediaId → productId
            const publishModeByMedia = new Map<string, string | null>(); // mediaId → publish mode
            for (const p of pending) {
                if (!p.publishedMediaId) continue;
                idMap.set(p.publishedMediaId, p.id);
                productByMedia.set(p.publishedMediaId, p.shopifyProductId);
                publishModeByMedia.set(p.publishedMediaId, p.publishMode);
            }
            let statuses;
            try {
                statuses = await verifyMediaStatus(admin, [...idMap.keys()]);
            } catch {
                // Verification call failed — leave rows as `publishing`, the
                // merchant can re-click Publish to retry verification.
                emitTelemetryEvent("publish_verify_failed", {
                    shop: session.shop,
                    jobId,
                    mediaCount: idMap.size,
                    attempt: attempt + 1,
                }, "warn");
                break;
            }
            const updates: Promise<unknown>[] = [];
            for (const [mediaId, imageId] of idMap) {
                const s = statuses.get(mediaId);
                if (s === "READY") {
                    const productId = productByMedia.get(mediaId);
                    const shouldPromote =
                        Boolean(productId) && publishModeByMedia.get(mediaId) === "replace_primary";
                    // Mark published first, then promote. Running these together
                    // let the status write clear a primary-promotion error.
                    updates.push(
                        (async () => {
                            await prisma.processedImage.update({
                                where: { id: imageId },
                                data: { status: "published", errorMessage: null },
                            });
                            if (!shouldPromote || !productId) return;
                            try {
                                await promoteMediaToPrimary(admin, { productId, mediaId });
                            } catch (err) {
                                console.error(
                                    "[publish] failed to promote media to primary",
                                    {
                                        jobId,
                                        productId,
                                        mediaId,
                                        error: err instanceof Error ? err.message : String(err),
                                    },
                                );
                                emitTelemetryEvent("publish_primary_promotion_failed", {
                                    shop: session.shop,
                                    jobId,
                                    productId,
                                    mediaId,
                                    ...serializeError(err),
                                }, "warn");
                                await prisma.processedImage.updateMany({
                                    where: { id: imageId, status: "published" },
                                    data: {
                                        errorMessage: "Published, but primary image update did not complete.",
                                    },
                                });
                            }
                        })().catch(() => undefined),
                    );
                } else if (s === "FAILED") {
                    emitTelemetryEvent("publish_media_ingest_failed", {
                        shop: session.shop,
                        jobId,
                        imageId,
                        mediaId,
                    }, "error");
                    updates.push(
                        prisma.processedImage
                            .update({
                                where: { id: imageId },
                                data: {
                                    status: "failed_publish",
                                    errorMessage: "Shopify media ingest reported FAILED",
                                },
                            })
                            .catch(() => undefined),
                    );
                }
                // PROCESSING / UNKNOWN → leave alone.
            }
            await Promise.all(updates);
            // Short delay before second attempt only.
            if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
        }
    } finally {
        await reconcileJobStatus(jobId);
    }

    return redirect(`/app/jobs/${jobId}`);
};

async function reconcileJobStatus(jobId: string): Promise<void> {
    const images = await prisma.processedImage.findMany({
        where: { jobId },
        select: { status: true },
    });
    const next = resolveSettledJobStatus(countStatuses(images));
    await prisma.processingJob
        .update({ where: { id: jobId }, data: { status: next, completedAt: new Date() } })
        .catch(() => undefined);
}
