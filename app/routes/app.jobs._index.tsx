import type { LoaderFunctionArgs, SerializeFrom } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
    Page,
    Card,
    Button,
    EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getBackgroundOption, toBackgroundId } from "@lib/backgrounds";
import { countStatuses } from "@lib/jobs/status";
import { getPublicUrl } from "@lib/storage";
import styles from "../styles/studio.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const jobs = await prisma.processingJob.findMany({
        where: { shop: session.shop },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
            images: {
                select: {
                    status: true,
                    originalUrl: true,
                    processedKey: true,
                    recoveryAttempts: true,
                    recoveryReason: true,
                },
            },
        },
    });

    const jobsWithPreviews = await Promise.all(
        jobs.map(async (job) => {
            const previewImages = await Promise.all(
                job.images.slice(0, 4).map(async (image) => ({
                    status: image.status,
                    previewUrl: image.processedKey
                        ? await getPublicUrl(image.processedKey)
                        : image.originalUrl,
                })),
            );
            return { ...job, previewImages };
        }),
    );

    return { jobs: jobsWithPreviews };
}

export default function JobsIndexRoute() {
    const { jobs } = useLoaderData<typeof loader>();

    if (jobs.length === 0) {
        return (
            <Page title="Jobs" backAction={{ url: "/app" }}>
                <TitleBar title="Jobs" />
                <Card>
                    <EmptyState
                        heading="No jobs yet"
                        action={{ content: "Select images", url: "/app/picker" }}
                        image=""
                    >
                        <p>Select product images and start your first catalog standardization job.</p>
                    </EmptyState>
                </Card>
            </Page>
        );
    }

    return (
        <Page
            title="Jobs"
            backAction={{ url: "/app" }}
            primaryAction={{ content: "New image set", url: "/app/picker" }}
        >
            <TitleBar title="Jobs" />
            <div className={styles.jobsSurface}>
                {jobs.map((job) => (
                    <JobCard key={job.id} job={job} />
                ))}
            </div>
        </Page>
    );
}

type JobWithImages = SerializeFrom<typeof loader>["jobs"][number];

function JobCard({ job }: { job: JobWithImages }) {
    const counts = countStatuses(job.images);
    const total = job.images.length;
    const processedCount =
        (counts.processed ?? 0) +
        (counts.approved ?? 0) +
        (counts.rejected ?? 0) +
        (counts.published ?? 0) +
        (counts.publishing ?? 0) +
        (counts.failed_publish ?? 0);
    const processingFailedCount = counts.failed ?? 0;
    const publishFailedCount = counts.failed_publish ?? 0;
    const failedCount = processingFailedCount + publishFailedCount;
    const recoveredCount = job.images.filter(
        (image) => image.recoveryAttempts > 0 || !!image.recoveryReason,
    ).length;
    const reviewableCount =
        (counts.processed ?? 0) +
        (counts.approved ?? 0) +
        (counts.rejected ?? 0) +
        (counts.published ?? 0) +
        (counts.publishing ?? 0) +
        (counts.failed_publish ?? 0);
    const publishActionableCount =
        (counts.approved ?? 0) +
        (counts.publishing ?? 0) +
        publishFailedCount;
    const canRetryProcessing = processingFailedCount > 0;
    const canReview = reviewableCount > 0;
    const canContinuePublishing = publishActionableCount > 0;
    const canRollback =
        (counts.published ?? 0) > 0 ||
        (counts.publishing ?? 0) > 0 ||
        publishFailedCount > 0;
    const primaryReviewLabel = getReviewActionLabel({
        approved: counts.approved ?? 0,
        publishing: counts.publishing ?? 0,
        failedPublish: publishFailedCount,
        published: counts.published ?? 0,
        processed: counts.processed ?? 0,
    });
    const nextStep = getNextStep({
        status: job.status,
        processingFailed: processingFailedCount,
        publishFailed: publishFailedCount,
        publishActionable: publishActionableCount,
        reviewable: reviewableCount,
        rollbackable: canRollback,
    });

    return (
        <article className={styles.jobStatusCard} aria-label={`${total} image ${backgroundLabel(job.background)} job, ${formatStatus(job.status)}`}>
            <div className={styles.jobPreviewStrip} aria-hidden="true">
                {job.previewImages.length > 0 ? (
                    job.previewImages.map((image, index) => (
                        <div key={`${job.id}-${index}`} className={styles.jobPreviewTile}>
                            <img
                                src={image.previewUrl}
                                alt=""
                                loading="lazy"
                                decoding="async"
                            />
                        </div>
                    ))
                ) : (
                    <div className={styles.jobPreviewTile} />
                )}
            </div>

            <div className={styles.jobStatusBody}>
                <div className={styles.jobStatusTopline}>
                    <div className={styles.jobIdentity}>
                        <p className={styles.jobCount}>{total} image{total === 1 ? "" : "s"}</p>
                        <h3>{backgroundLabel(job.background)} finish</h3>
                    </div>
                    <span className={`${styles.jobStatusPill} ${statusToneClass(job.status)}`}>
                        {formatStatus(job.status)}
                    </span>
                </div>

                <p className={styles.jobNextStep}>{nextStep}</p>

                <div className={styles.jobMetaRow} aria-label="Job summary">
                    <span className={styles.jobMetaPill}>{processedCount} standardized</span>
                    {failedCount > 0 && <span className={styles.jobMetaPillAttention}>{failedCount} failed</span>}
                    {recoveredCount > 0 && <span className={styles.jobMetaPill}>{recoveredCount} recovered</span>}
                    <span className={styles.jobMetaQuiet}>Created {formatDate(job.createdAt)}</span>
                    {job.completedAt && <span className={styles.jobMetaQuiet}>Completed {formatDate(job.completedAt)}</span>}
                </div>
            </div>

            <div className={styles.jobActionStack}>
                {canRetryProcessing && (
                    <Form method="post" action={`/app/jobs/${job.id}/retry`}>
                        <Button
                            submit
                            accessibilityLabel={`Retry ${processingFailedCount} failed processing image${processingFailedCount === 1 ? "" : "s"}`}
                        >
                            Retry failed images
                        </Button>
                    </Form>
                )}
                {canContinuePublishing && (
                    <Button
                        variant="primary"
                        url={`/app/jobs/${job.id}/preview`}
                        accessibilityLabel={`${primaryReviewLabel} for ${total} image${total === 1 ? "" : "s"}`}
                    >
                        {primaryReviewLabel}
                    </Button>
                )}
                {canReview && !canContinuePublishing && (
                    <Button
                        url={`/app/jobs/${job.id}/preview`}
                        accessibilityLabel={`Review results for ${total} image${total === 1 ? "" : "s"}`}
                    >
                        Review results
                    </Button>
                )}
                {canRollback && (
                    <Button
                        url={`/app/jobs/${job.id}`}
                        accessibilityLabel={`Review rollback for ${total} image${total === 1 ? "" : "s"}`}
                    >
                        Review rollback
                    </Button>
                )}
                {!canReview && !canContinuePublishing && (
                    <Button
                        url={`/app/jobs/${job.id}`}
                        accessibilityLabel={`View progress for ${total} image${total === 1 ? "" : "s"}`}
                    >
                        View progress
                    </Button>
                )}
            </div>
        </article>
    );
}

function backgroundLabel(id: string): string {
    const background = toBackgroundId(id);
    return background ? getBackgroundOption(background).label : "Unknown background";
}

function formatStatus(status: string): string {
    return status.replace(/_/g, " ");
}

function formatDate(value: string | Date): string {
    return new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function statusToneClass(status: string): string {
    if (status === "completed" || status === "published") return styles.jobStatusComplete;
    if (status === "failed" || status === "partially_published") return styles.jobStatusAttention;
    if (status === "queued" || status === "processing" || status === "publishing") return styles.jobStatusActive;
    if (status === "canceled") return styles.jobStatusMuted;
    return styles.jobStatusNeutral;
}

function getReviewActionLabel({
    approved,
    publishing,
    failedPublish,
    published,
    processed,
}: {
    approved: number;
    publishing: number;
    failedPublish: number;
    published: number;
    processed: number;
}): string {
    if (failedPublish > 0) return "Retry publish";
    if (publishing > 0) return "Check publish";
    if (approved > 0) return "Continue publishing";
    if (published > 0) return "Review published";
    if (processed > 0) return "Review results";
    return "Review results";
}

function getNextStep({
    status,
    processingFailed,
    publishFailed,
    publishActionable,
    reviewable,
    rollbackable,
}: {
    status: string;
    processingFailed: number;
    publishFailed: number;
    publishActionable: number;
    reviewable: number;
    rollbackable: boolean;
}): string {
    if (publishFailed > 0) {
        return "Some images need publish retry. Only approved images can publish.";
    }
    if (processingFailed > 0) {
        return "Some images need processing retry. Retry does not use extra monthly capacity.";
    }
    if (publishActionable > 0) {
        return "Approved images are ready to publish.";
    }
    if (rollbackable) {
        return "Published Unoir media can be reviewed for rollback while originals remain in Shopify.";
    }
    if (reviewable > 0) {
        return "Open review to compare results and decide what should publish.";
    }
    if (status === "queued" || status === "processing") {
        return "Processing is underway. This job will update as images finish.";
    }
    if (status === "canceled") {
        return "This job was canceled before publishing. Originals were not changed.";
    }
    return "Open the job for details and recovery options.";
}
