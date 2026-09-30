import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { toBackgroundId } from "@lib/backgrounds";
import { countStatuses, resolveSettledJobStatus, WorkflowLockError, workflowLockClaimWhere } from "@lib/jobs/status";
import { enqueueBgRemoval } from "@lib/queue";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return redirect(`/app/jobs/${params.jobId}`);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const jobId = params.jobId;
    if (!jobId) throw new Response("Not found", { status: 404 });

    const job = await prisma.processingJob.findFirst({
        where: { id: jobId, shop: session.shop },
        include: {
            images: {
                where: { status: "failed" },
            },
        },
    });
    if (!job) throw new Response("Not found", { status: 404 });
    if (job.images.length === 0) return redirect(`/app/jobs/${jobId}`);
    const background = toBackgroundId(job.background);
    if (!background) {
        await prisma.processedImage.updateMany({
            where: { jobId, status: "failed" },
            data: { errorMessage: `Unknown background option: ${job.background}` },
        });
        return redirect(`/app/jobs/${jobId}`);
    }

    // Retry reuses the same ProcessedImage row. That row already counts as one
    // premium export (usage.ts); failure does not release it, so retry does not
    // add a second export and stays available after the monthly cap. It bypasses
    // the new-job throttle.
    // Claim rows one-by-one so a double-submit can't enqueue the same failed
    // image twice. Do not steal a fresh publish/rollback lock — that claim is
    // rolled back with the image updates.
    let claimedImageIds: string[];
    try {
        claimedImageIds = await prisma.$transaction(async (tx) => {
            const claimed: string[] = [];
            for (const image of job.images) {
                const result = await tx.processedImage.updateMany({
                    where: { id: image.id, jobId, status: "failed" },
                    data: { status: "pending", errorMessage: null },
                });
                if (result.count > 0) claimed.push(image.id);
            }
            if (claimed.length === 0) return claimed;
            const jobUpdate = await tx.processingJob.updateMany({
                where: workflowLockClaimWhere(jobId),
                data: { status: "queued", completedAt: null },
            });
            if (jobUpdate.count === 0) throw new WorkflowLockError();
            return claimed;
        });
    } catch (err) {
        if (err instanceof WorkflowLockError) {
            return redirect(`/app/jobs/${jobId}?error=rollback-in-progress`);
        }
        throw err;
    }

    if (claimedImageIds.length === 0) return redirect(`/app/jobs/${jobId}`);
    const claimedImages = job.images.filter((image) => claimedImageIds.includes(image.id));

    // Per-image enqueue. We DON'T flip everything back to `failed` on a
    // partial enqueue failure — that would clobber rows already accepted
    // by BullMQ. Instead, only the rows we couldn't enqueue are flipped.
    const enqueueFailures: string[] = [];
    await Promise.all(
        claimedImages.map(async (image) => {
            try {
                await enqueueBgRemoval({
                    jobId: job.id,
                    imageId: image.id,
                    shop: session.shop,
                    background,
                    sourceUrl: image.originalUrl,
                    shopifyMediaId: image.shopifyMediaId,
                });
            } catch (err) {
                enqueueFailures.push(image.id);
                console.error(
                    `[retry] enqueue failed for image=${image.id}:`,
                    err instanceof Error ? err.message : String(err),
                );
            }
        }),
    );

    if (enqueueFailures.length > 0) {
        await prisma.processedImage
            .updateMany({
                where: { id: { in: enqueueFailures } },
                data: {
                    status: "failed",
                    errorMessage: "queue unavailable at retry time",
                },
            })
            .catch(() => undefined);
        // Every claimed retry failed to enqueue. Reconcile from image rows
        // when nothing is still in flight, so a mixed job is not labeled
        // failed and dropped out of review. Leave `queued` alone if other
        // images are still pending — the worker will settle those.
        if (enqueueFailures.length === claimedImages.length) {
            const images = await prisma.processedImage.findMany({
                where: { jobId },
                select: { status: true },
            });
            const counts = countStatuses(images);
            const inFlight = (counts.pending ?? 0) + (counts.processing ?? 0);
            if (inFlight === 0) {
                await prisma.processingJob
                    .updateMany({
                        where: workflowLockClaimWhere(jobId),
                        data: {
                            status: resolveSettledJobStatus(counts),
                            completedAt: new Date(),
                        },
                    })
                    .catch(() => undefined);
            }
            return redirect(`/app/jobs/${jobId}?error=queue-unavailable`);
        }
        return redirect(`/app/jobs/${jobId}?error=queue-partial`);
    }

    return redirect(`/app/jobs/${jobId}`);
};
