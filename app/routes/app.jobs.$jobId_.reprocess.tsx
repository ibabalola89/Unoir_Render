import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { toBackgroundId } from "@lib/backgrounds";
import { countStatuses, resolveSettledJobStatus } from "@lib/jobs/status";
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

    const claimed = await prisma.processedImage.updateMany({
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

    if (claimed.count === 0) {
        return redirect(`/app/jobs/${jobId}/preview`);
    }

    const background = toBackgroundId(image.job.background);
    if (!background) {
        await prisma.processedImage.update({
            where: { id: image.id },
            data: { status: "failed", errorMessage: `Unknown background option: ${image.job.background}` },
        });
        return redirect(`/app/jobs/${jobId}/preview`);
    }

    await prisma.processingJob.update({
        where: { id: jobId },
        data: { status: "queued", completedAt: null },
    });

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
    const status = resolveSettledJobStatus(countStatuses(images));
    await prisma.processingJob.update({
        where: { id: jobId },
        data: { status, completedAt: new Date() },
    });
}