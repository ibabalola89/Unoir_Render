import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { toBackgroundId } from "@lib/backgrounds";
import { countStatuses, resolveSettledJobStatus, WorkflowLockError, workflowLockClaimWhere } from "@lib/jobs/status";
import { enqueueBgRemoval, getBgRemovalQueue } from "@lib/queue";
import { emitTelemetryEvent, serializeError } from "@lib/telemetry";

const REPROCESSABLE_STATUSES = ["processed", "approved", "rejected", "failed"];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return redirect(`/app/jobs/${params.jobId}/preview`);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const jobId = params.jobId;
    if (!jobId) throw new Response("Not found", { status: 404 });

    const form = await request.formData();
    const imageId = String(form.get("imageId") ?? "");
    if (!imageId) return redirect(`/app/jobs/${jobId}/preview?error=invalid-input`);

    const image = await prisma.processedImage.findFirst({
        where: {
            id: imageId,
            jobId,
            job: { shop: session.shop },
        },
        select: {
            id: true,
            originalUrl: true,
            shopifyMediaId: true,
            job: { select: { id: true, background: true } },
        },
    });
    if (!image) throw new Response("Not found", { status: 404 });

    const background = toBackgroundId(image.job.background);
    if (!background) {
        await prisma.processedImage.updateMany({
            where: { id: image.id, jobId, status: { in: REPROCESSABLE_STATUSES } },
            data: { status: "failed", errorMessage: `Unknown background option: ${image.job.background}` },
        });
        return redirect(`/app/jobs/${jobId}/preview`);
    }

    let claimed = false;
    try {
        claimed = await prisma.$transaction(async (tx) => {
            const result = await tx.processedImage.updateMany({
                where: { id: image.id, jobId, status: { in: REPROCESSABLE_STATUSES } },
                data: {
                    status: "pending",
                    processedKey: null,
                    processingStartedAt: null,
                    recoveryAttempts: 0,
                    lastRecoveryAt: null,
                    recoveryReason: null,
                    publishedMediaId: null,
                    publishMode: null,
                    errorMessage: null,
                },
            });
            if (result.count === 0) return false;
            const jobUpdate = await tx.processingJob.updateMany({
                where: workflowLockClaimWhere(jobId),
                data: { status: "queued", completedAt: null },
            });
            if (jobUpdate.count === 0) throw new WorkflowLockError();
            return true;
        });
    } catch (err) {
        if (err instanceof WorkflowLockError) {
            return redirect(`/app/jobs/${jobId}/preview?error=publish-in-progress`);
        }
        throw err;
    }

    if (!claimed) {
        return redirect(`/app/jobs/${jobId}/preview`);
    }

    try {
        await getBgRemovalQueue().remove(image.id).catch(() => undefined);
        await enqueueBgRemoval({
            jobId,
            imageId: image.id,
            shop: session.shop,
            background,
            sourceUrl: image.originalUrl,
            shopifyMediaId: image.shopifyMediaId,
        });
    } catch (err) {
        emitTelemetryEvent("reprocess_queue_failed", {
            shop: session.shop,
            jobId,
            imageId: image.id,
            ...serializeError(err),
        }, "error");
        await prisma.processedImage.update({
            where: { id: image.id },
            data: {
                status: "failed",
                errorMessage: err instanceof Error ? err.message : String(err),
            },
        });
        await reconcileAfterReprocessFailure(jobId);
        return redirect(`/app/jobs/${jobId}/preview?error=queue-unavailable`);
    }

    return redirect(`/app/jobs/${jobId}`);
};

async function reconcileAfterReprocessFailure(jobId: string): Promise<void> {
    const images = await prisma.processedImage.findMany({
        where: { jobId },
        select: { status: true },
    });
    const counts = countStatuses(images);
    const inFlight = (counts.pending ?? 0) + (counts.processing ?? 0);
    if (inFlight > 0) return;
    await prisma.processingJob.updateMany({
        where: workflowLockClaimWhere(jobId),
        data: { status: resolveSettledJobStatus(counts), completedAt: new Date() },
    });
}