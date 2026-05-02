import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { deletePublishedMedia } from "@lib/shopify/publish";
import { emitTelemetryEvent, serializeError } from "@lib/telemetry";

/**
 * Rollback action.
 *
 * POST /app/jobs/:jobId/rollback
 *
 * Deletes every media we published for this job from Shopify and returns the
 * image rows to the `approved` state so the merchant can re-publish if they
 * want. The original product media is unaffected (we never touched it).
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return redirect(`/app/jobs/${params.jobId}`);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const jobId = params.jobId;
    if (!jobId) throw new Response("Not found", { status: 404 });

    const owned = await prisma.processingJob.findFirst({
        where: { id: jobId, shop: session.shop },
        select: { id: true },
    });
    if (!owned) throw new Response("Not found", { status: 404 });

    // Atomically claim: rollback can clean fully published jobs, partially
    // published jobs, and stale `publishing` jobs left by a crashed action.
    const STALE_MS = 5 * 60 * 1000;
    const claim = await prisma.processingJob.updateMany({
        where: {
            id: jobId,
            OR: [
                { status: "published" },
                { status: "partially_published" },
                { status: "publishing", updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
            ],
        },
        data: { status: "publishing" },
    });
    if (claim.count === 0) {
        return redirect(`/app/jobs/${jobId}?error=rollback-in-progress`);
    }

    const images = await prisma.processedImage.findMany({
        where: {
            jobId,
            status: { in: ["published", "publishing", "failed_publish"] },
            publishedMediaId: { not: null },
        },
    });

    const CONCURRENCY = 4;
    const queue = [...images];
    let failedDeletes = 0;
    let rollbackResult: "complete" | "partial" = "complete";
    try {
        const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () =>
            (async () => {
                while (queue.length > 0) {
                    const image = queue.shift();
                    if (!image?.publishedMediaId) continue;
                    try {
                        await deletePublishedMedia(admin, {
                            productId: image.shopifyProductId,
                            mediaId: image.publishedMediaId,
                        });
                        await prisma.processedImage.update({
                            where: { id: image.id },
                            data: {
                                status: "approved",
                                publishedMediaId: null,
                                publishMode: null,
                                errorMessage: null,
                            },
                        });
                    } catch (err) {
                        failedDeletes += 1;
                        const message = err instanceof Error ? err.message : String(err);
                        emitTelemetryEvent("rollback_delete_failed", {
                            shop: session.shop,
                            jobId,
                            imageId: image.id,
                            productId: image.shopifyProductId,
                            mediaId: image.publishedMediaId,
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
        await Promise.all(workers);
    } finally {
        // Reconcile to the most accurate post-rollback status. If any created
        // Shopify media remains tracked locally, keep the rollback affordance
        // available; otherwise return to `completed` so the merchant can retry.
        const stillRollbackable = await prisma.processedImage.count({
            where: {
                jobId,
                status: { in: ["published", "publishing", "failed_publish"] },
                publishedMediaId: { not: null },
            },
        });
        await prisma.processingJob.update({
            where: { id: jobId },
            data: {
                status: stillRollbackable === 0 ? "completed" : "partially_published",
                completedAt: new Date(),
            },
        });
        rollbackResult = failedDeletes > 0 || stillRollbackable > 0 ? "partial" : "complete";
    }

    return redirect(`/app/jobs/${jobId}?rollback=${rollbackResult}`);
};
