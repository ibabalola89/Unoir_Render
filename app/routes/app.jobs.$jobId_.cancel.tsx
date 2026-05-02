import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getBgRemovalQueue } from "@lib/queue";

const CANCELABLE_JOB_STATUSES = ["queued", "processing"];
const CANCELABLE_IMAGE_STATUSES = ["pending", "processing"];

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
                where: { status: { in: CANCELABLE_IMAGE_STATUSES } },
                select: { id: true },
            },
        },
    });
    if (!job) throw new Response("Not found", { status: 404 });

    if (!CANCELABLE_JOB_STATUSES.includes(job.status) || job.images.length === 0) {
        return redirect(`/app/jobs/${jobId}`);
    }

    const queue = getBgRemovalQueue();
    await Promise.all(
        job.images.map(async (image) => {
            try {
                await queue.remove(image.id);
            } catch (err) {
                // Active jobs are locked by BullMQ and cannot always be removed.
                // The worker re-checks DB state and will no-op canceled rows.
                console.warn(
                    `[cancel] queue remove skipped for image=${image.id}:`,
                    err instanceof Error ? err.message : String(err),
                );
            }
        }),
    );

    await prisma.$transaction([
        prisma.processingJob.updateMany({
            where: { id: jobId, shop: session.shop, status: { in: CANCELABLE_JOB_STATUSES } },
            data: { status: "canceled", completedAt: new Date() },
        }),
        prisma.processedImage.updateMany({
            where: { jobId, status: { in: CANCELABLE_IMAGE_STATUSES } },
            data: { status: "canceled", errorMessage: null },
        }),
    ]);

    return redirect(`/app/jobs/${jobId}`);
};
