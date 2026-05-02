import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { toBackgroundId } from "@lib/backgrounds";
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

    // Retry does not create new ProcessedImage rows, so it does not consume
    // additional monthly quota and intentionally bypasses the new-job throttle.
    // Claim rows one-by-one so a double-submit can't enqueue the same failed
    // image twice and then mark a successfully claimed row failed because
    // BullMQ rejected the duplicate job id.
    const claimedImageIds = await prisma.$transaction(async (tx) => {
        const claimed: string[] = [];
        for (const image of job.images) {
            const result = await tx.processedImage.updateMany({
                where: { id: image.id, jobId, status: "failed" },
                data: { status: "pending", errorMessage: null },
            });
            if (result.count > 0) claimed.push(image.id);
        }
        if (claimed.length > 0) {
            await tx.processingJob.update({
                where: { id: jobId },
                data: { status: "queued", completedAt: null },
            });
        }
        return claimed;
    });

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
        // Only flip the parent job to `failed` if EVERY retry attempt failed.
        // If some succeeded, let the worker finalize the job naturally.
        if (enqueueFailures.length === claimedImages.length) {
            await prisma.processingJob
                .update({ where: { id: jobId }, data: { status: "failed" } })
                .catch(() => undefined);
            return redirect(`/app/jobs/${jobId}?error=queue-unavailable`);
        }
        return redirect(`/app/jobs/${jobId}?error=queue-partial`);
    }

    return redirect(`/app/jobs/${jobId}`);
};
