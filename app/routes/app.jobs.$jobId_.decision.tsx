import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Per-image approval endpoint.
 *
 * POST /app/jobs/:jobId/decision
 * form fields:
 *   imageId: ProcessedImage.id
 *   decision: "approve" | "reject"
 *
 * Constraints:
 *  - Image must belong to the current shop and the URL's job.
 *  - Image must be in `processed` status (can't approve a pending/failed/published one).
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const jobId = params.jobId;
    if (!jobId) throw new Response("Not found", { status: 404 });

    const form = await request.formData();
    const bulk = String(form.get("bulk") ?? "");

    // Bulk approve / reject all currently `processed` images for this job.
    if (bulk === "approve" || bulk === "reject") {
        const target = bulk === "approve" ? "approved" : "rejected";
        // Authorization via shop-scoped job lookup.
        const job = await prisma.processingJob.findFirst({
            where: { id: jobId, shop: session.shop },
            select: { id: true },
        });
        if (!job) throw new Response("Not found", { status: 404 });
        await prisma.processedImage.updateMany({
            where: { jobId, status: "processed" },
            data: { status: target },
        });
        return redirect(`/app/jobs/${jobId}/preview`);
    }

    const imageId = String(form.get("imageId") ?? "");
    const decision = String(form.get("decision") ?? "");

    if (!imageId || (decision !== "approve" && decision !== "reject")) {
        return json({ error: "invalid input" }, { status: 400 });
    }

    // Shop-scoped + job-scoped lookup is the authorization check.
    const image = await prisma.processedImage.findFirst({
        where: {
            id: imageId,
            jobId,
            job: { shop: session.shop },
        },
    });
    if (!image) throw new Response("Not found", { status: 404 });

    const target = decision === "approve" ? "approved" : "rejected";

    // Idempotent: re-applying the same decision is a no-op.
    if (image.status === target) {
        return redirect(`/app/jobs/${jobId}/preview`);
    }

    // Only allow transitions from processed / approved / rejected.
    if (
        image.status !== "processed" &&
        image.status !== "approved" &&
        image.status !== "rejected"
    ) {
        return json(
            { error: `cannot ${decision} image with status ${image.status}` },
            { status: 409 },
        );
    }

    await prisma.processedImage.update({
        where: { id: imageId },
        data: { status: target },
    });

    return redirect(`/app/jobs/${jobId}/preview`);
};
