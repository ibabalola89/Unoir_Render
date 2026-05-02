import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getPublishUrl } from "@lib/storage";
import {
    deletePublishedMedia,
    promoteMediaToPrimary,
    publishProcessedMedia,
    verifyMediaStatus,
} from "@lib/shopify/publish";
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

    // Atomically claim the job. Allowed prior states: completed (first publish),
    // published / partially_published (re-publish remaining approved + verify
    // outstanding `publishing` rows). Stale `publishing` jobs older than 5min
    // are also reclaimable as a recovery hatch if a previous run crashed.
    const STALE_MS = 5 * 60 * 1000;
    const claim = await prisma.processingJob.updateMany({
        where: {
            id: jobId,
            OR: [
                { status: "completed" },
                { status: "published" },
                { status: "partially_published" },
                { status: "publishing", updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
            ],
        },
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
                            if (image.status === "failed_publish" && image.publishedMediaId) {
                                await deletePublishedMedia(admin, {
                                    productId: image.shopifyProductId,
                                    mediaId: image.publishedMediaId,
                                }).catch(() => undefined);
                            }
                            const sourceUrl = await getPublishUrl(image.processedKey);
                            const result = await publishProcessedMedia(admin, {
                                productId: image.shopifyProductId,
                                sourceUrl,
                                altText: image.shopifyAltText,
                            });
                            await prisma.processedImage.update({
                                where: { id: image.id },
                                data: {
                                    status: "publishing",
                                    publishedMediaId: result.mediaId,
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
                    updates.push(
                        prisma.processedImage
                            .update({
                                where: { id: imageId },
                                data: { status: "published", errorMessage: null },
                            })
                            .catch(() => undefined),
                    );
                    // Best-effort: promote the new media to position 0 so the
                    // PDP shows it as the primary image automatically. Failure
                    // here does NOT undo the publish — the image is live, it
                    // just isn't primary yet. Keep provider details out of the
                    // merchant-facing row; log the raw error server-side.
                    const productId = productByMedia.get(mediaId);
                    if (productId && publishModeByMedia.get(mediaId) === "replace_primary") {
                        updates.push(
                            promoteMediaToPrimary(admin, { productId, mediaId })
                                .catch((err) => {
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
                                    return prisma.processedImage
                                        .update({
                                            where: { id: imageId },
                                            data: {
                                                errorMessage: "Published, but primary image update did not complete.",
                                            },
                                        })
                                        .catch(() => undefined);
                                }),
                        );
                    }
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
    const [published, approvedRemaining, publishingRemaining, failedPublish] = await Promise.all([
        prisma.processedImage.count({ where: { jobId, status: "published" } }),
        prisma.processedImage.count({ where: { jobId, status: "approved" } }),
        prisma.processedImage.count({ where: { jobId, status: "publishing" } }),
        prisma.processedImage.count({ where: { jobId, status: "failed_publish" } }),
    ]);
    const outstanding = approvedRemaining + publishingRemaining + failedPublish;
    let next: "published" | "partially_published" | "completed";
    if (published > 0 && outstanding === 0) next = "published";
    else if (published > 0 || publishingRemaining > 0 || failedPublish > 0) {
        next = "partially_published";
    }
    else next = "completed";
    await prisma.processingJob
        .update({ where: { id: jobId }, data: { status: next, completedAt: new Date() } })
        .catch(() => undefined);
}
