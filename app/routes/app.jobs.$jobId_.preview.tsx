import type { LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useRevalidator, useSearchParams } from "@remix-run/react";
import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import {
    ReactCompareSlider,
    ReactCompareSliderCssVars,
    ReactCompareSliderHandle,
    ReactCompareSliderImage,
} from "react-compare-slider";
import {
    Page,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { AppNotice } from "../components/AppNotice";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getBackgroundOption, toBackgroundId } from "@lib/backgrounds";
import { getPublicUrl } from "@lib/storage";
import { getPreviewErrorMessage, getSafeImageMessage } from "@lib/ui/failureCopy";
import styles from "../styles/studio.module.css";

const compareHandleStyle = {
    [ReactCompareSliderCssVars.handleColor]: "#191815",
} as CSSProperties;

const compareHandleButtonStyle: CSSProperties = {
    width: "3rem",
    height: "3rem",
    border: "1px solid rgba(25, 24, 21, 0.28)",
    backgroundColor: "rgba(255, 249, 237, 0.88)",
    boxShadow: "0 12px 34px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.42)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    transition: "transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease",
};

const compareHandleLinesStyle: CSSProperties = {
    outline: "1px solid rgba(255, 249, 237, 0.72)",
    boxShadow: "0 0 18px rgba(0, 0, 0, 0.36)",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const jobId = params.jobId;
    if (!jobId) throw new Response("Not found", { status: 404 });

    const job = await prisma.processingJob.findFirst({
        where: { id: jobId, shop: session.shop },
        include: { images: { orderBy: { createdAt: "asc" } } },
    });
    if (!job) throw new Response("Not found", { status: 404 });

    const images = await Promise.all(
        job.images.map(async (img, index) => ({
            ...img,
            displayName: `Image ${index + 1}`,
            processedUrl: img.processedKey ? await getPublicUrl(img.processedKey) : null,
        })),
    );

    const counts = images.reduce<Record<string, number>>((acc, img) => {
        acc[img.status] = (acc[img.status] ?? 0) + 1;
        return acc;
    }, {});
    const background = toBackgroundId(job.background);
    const finishLabel = background ? getBackgroundOption(background).label : "Unknown finish";

    return { job: { ...job, images }, counts, finishLabel };
};

export default function PreviewRoute() {
    const { job, counts, finishLabel } = useLoaderData<typeof loader>();
    const navigation = useNavigation();
    const [searchParams] = useSearchParams();
    const isSubmitting = navigation.state === "submitting";
    const isPublishing =
        isSubmitting && navigation.formAction?.endsWith("/publish") === true;
    const revalidator = useRevalidator();

    const stillProcessing = (counts.pending ?? 0) + (counts.processing ?? 0);
    useEffect(() => {
        if (stillProcessing === 0) return;
        const tick = () => {
            if (!document.hidden) revalidator.revalidate();
        };
        const id = setInterval(tick, 2500);
        const onVisibilityChange = () => {
            if (!document.hidden) revalidator.revalidate();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            clearInterval(id);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [stillProcessing, revalidator]);

    const approved = counts.approved ?? 0;
    const publishing = counts.publishing ?? 0;
    const failedPublish = counts.failed_publish ?? 0;
    const publishActionable = approved + publishing + failedPublish;
    const reviewable = job.images.filter(
        (i) =>
            i.status === "processed" ||
            i.status === "approved" ||
            i.status === "rejected" ||
            i.status === "publishing" ||
            i.status === "failed_publish" ||
            i.status === "published",
    );
    const allReviewed = stillProcessing === 0 && (counts.processed ?? 0) === 0;
    const publishButtonText =
        approved > 0
            ? `Publish (${approved})`
            : publishing > 0
                ? `Check publish (${publishing})`
                : failedPublish > 0
                    ? `Retry publish (${failedPublish})`
                    : "Publish";
    const publishError = getPreviewErrorMessage(searchParams.get("error"));

    return (
        <Page
            backAction={{ url: `/app/jobs/${job.id}` }}
            title="Studio"
        >
            <TitleBar title="Studio" />
            <section className={styles.studioShell}>
                <header className={styles.studioHeader}>
                    <div className={styles.studioIntro}>
                        <div className={styles.studioKicker}>
                            {finishLabel} finish · {approved} approved / {counts.rejected ?? 0} rejected
                        </div>
                        <h2 className={styles.studioTitle}>Review and Publish</h2>
                        <p className={styles.studioSummary}>
                            Compare each result, approve what belongs in your catalog, and publish only when the set feels right.
                        </p>
                    </div>
                    <div className={styles.studioActions}>
                        {(counts.processed ?? 0) > 0 && (
                            <div className={styles.reviewBulkActions} aria-label="Bulk review actions">
                                <Form method="post" action={`/app/jobs/${job.id}/decision`}>
                                    <input type="hidden" name="bulk" value="approve" />
                                    <button
                                        className={styles.secondaryAction}
                                        type="submit"
                                        disabled={isSubmitting}
                                    >
                                        Approve All ({counts.processed ?? 0})
                                    </button>
                                </Form>
                                <Form method="post" action={`/app/jobs/${job.id}/decision`}>
                                    <input type="hidden" name="bulk" value="reject" />
                                    <button
                                        className={styles.rejectAction}
                                        type="submit"
                                        disabled={isSubmitting}
                                    >
                                        Reject All ({counts.processed ?? 0})
                                    </button>
                                </Form>
                            </div>
                        )}
                        <Form method="post" action={`/app/jobs/${job.id}/publish`} className={styles.publishControls}>
                            <div className={styles.publishModePanel}>
                                <fieldset className={styles.publishModeGroup} disabled={isPublishing}>
                                    <legend className={styles.srOnly}>Publish behavior</legend>
                                    <label className={styles.publishModeOption}>
                                        <input type="radio" name="publishMode" value="append" defaultChecked />
                                        <span>Append to gallery</span>
                                    </label>
                                    <label className={styles.publishModeOption}>
                                        <input type="radio" name="publishMode" value="replace_primary" />
                                        <span>Use as primary</span>
                                    </label>
                                </fieldset>
                                <p className={styles.publishSafetyCopy}>
                                    Original media stays in place. Only approved images publish to Shopify.
                                </p>
                            </div>
                            <button
                                className={`${styles.primaryAction} ${styles.publishAction}`}
                                type="submit"
                                disabled={publishActionable === 0 || !allReviewed || isPublishing}
                            >
                                {isPublishing ? "Publishing..." : publishButtonText}
                            </button>
                        </Form>
                    </div>
                </header>

                {publishError && (
                    <AppNotice compact tone="warning" title="Publishing needs attention">
                        <p>{publishError}</p>
                    </AppNotice>
                )}

                {stillProcessing > 0 && (
                    <p className={styles.reviewRequirement} role="status">
                        Publishing unlocks when processing finishes.
                    </p>
                )}
                {stillProcessing === 0 && !allReviewed && (
                    <p className={styles.reviewRequirement} role="status">
                        Approve or reject every processed image before publishing.
                    </p>
                )}
                {publishing > 0 && (
                    <AppNotice compact tone="info" title="Publishing in progress">
                        <p>
                            Shopify is still ingesting {publishing} image
                            {publishing === 1 ? "" : "s"}. Check again to confirm when
                            publishing is ready.
                        </p>
                    </AppNotice>
                )}
                {failedPublish > 0 && (
                    <AppNotice compact tone="warning" title="Publishing retry available">
                        <p>
                            {failedPublish} image{failedPublish === 1 ? "" : "s"} failed
                            Shopify publishing and can be retried.
                        </p>
                    </AppNotice>
                )}

                <div className={styles.reviewGrid}>
                    {reviewable.length === 0 && (
                        <div className={styles.emptyProcessed}>No processed images yet.</div>
                    )}
                    {reviewable.map((img) => (
                        <ImageReviewCard
                            key={img.id}
                            image={img}
                            jobId={job.id}
                            disabled={isSubmitting}
                            isTransparentOutput={job.background === "transparent"}
                            finishLabel={finishLabel}
                        />
                    ))}
                </div>
            </section>
        </Page>
    );
}

interface ReviewImage {
    id: string;
    status: string;
    originalUrl: string;
    processedUrl: string | null;
    shopifyMediaId: string;
    displayName: string;
    errorMessage: string | null;
}

function ImageReviewCard({
    image,
    jobId,
    disabled,
    isTransparentOutput,
    finishLabel,
}: {
    image: ReviewImage;
    jobId: string;
    disabled: boolean;
    isTransparentOutput: boolean;
    finishLabel: string;
}) {
    const canDecide =
        image.status === "processed" ||
        image.status === "approved" ||
        image.status === "rejected";
    const canReprocess =
        image.status === "processed" ||
        image.status === "approved" ||
        image.status === "rejected" ||
        image.status === "failed";

    return (
        <article className={styles.reviewCard}>
            <div className={styles.reviewCardHeader}>
                <span className={styles.mediaId}>{image.displayName}</span>
                <div className={styles.reviewMetaPills}>
                    <span className={styles.finishLozenge}>{finishLabel}</span>
                    <span className={styles.statusLozenge}>{formatStatus(image.status)}</span>
                </div>
            </div>

            {image.processedUrl ? (
                <CompareSlider
                    image={image}
                    isTransparentOutput={isTransparentOutput}
                />
            ) : (
                <div className={styles.comparePane}>
                    <div className={styles.emptyProcessed}>Not yet processed.</div>
                </div>
            )}

            <div className={styles.reviewCardFooter}>
                <div className={styles.subtleLabel}>{formatStatus(image.status)}</div>
                <div className={styles.decisionRow}>
                    <Form method="post" action={`/app/jobs/${jobId}/decision`}>
                        <input type="hidden" name="imageId" value={image.id} />
                        <input type="hidden" name="decision" value="approve" />
                        <button
                            className={styles.approveAction}
                            type="submit"
                            disabled={disabled || !canDecide || image.status === "approved"}
                        >
                            Approve
                        </button>
                    </Form>
                    <Form method="post" action={`/app/jobs/${jobId}/decision`}>
                        <input type="hidden" name="imageId" value={image.id} />
                        <input type="hidden" name="decision" value="reject" />
                        <button
                            className={styles.rejectAction}
                            type="submit"
                            disabled={disabled || !canDecide || image.status === "rejected"}
                        >
                            Reject
                        </button>
                    </Form>
                    <Form method="post" action={`/app/jobs/${jobId}/reprocess`}>
                        <input type="hidden" name="imageId" value={image.id} />
                        <button
                            className={styles.secondaryAction}
                            type="submit"
                            disabled={disabled || !canReprocess}
                        >
                            Reprocess
                        </button>
                    </Form>
                </div>
            </div>

            {image.errorMessage && (
                <AppNotice compact tone="warning" title="Image needs attention">
                    <p>{getSafeImageMessage(image.status)}</p>
                </AppNotice>
            )}
        </article>
    );
}

function CompareSlider({
    image,
    isTransparentOutput,
}: {
    image: ReviewImage;
    isTransparentOutput: boolean;
}) {
    const sliderRef = useRef<HTMLDivElement | null>(null);
    const compareHelpId = `${image.id}-compare-help`;
    const originalLabelId = `${image.id}-original-label`;
    const processedLabelId = `${image.id}-processed-label`;
    const defaultPosition = 80;
    const sliderLabel = `${image.displayName} original and processed comparison slider`;

    const updateHandleAccessibility = (position: number) => {
        const handle = sliderRef.current?.querySelector<HTMLElement>('[data-rcs="handle-root"]');
        if (!handle) return;
        handle.setAttribute("aria-label", sliderLabel);
        handle.setAttribute("aria-describedby", compareHelpId);
        handle.setAttribute("aria-valuetext", `${Math.round(position)}% processed image visible`);
    };

    useEffect(() => {
        updateHandleAccessibility(defaultPosition);
    });

    return (
        <div
            ref={sliderRef}
            className={styles.compareSlider}
            role="group"
            aria-label={`${image.displayName} original and processed comparison`}
            aria-describedby={compareHelpId}
        >
            <p id={compareHelpId} className={styles.srOnly}>
                Use the slider handle with arrow keys or drag it to compare the original image with the processed result.
            </p>
            <div className={styles.compareLabels}>
                <span id={originalLabelId}>Original</span>
                <span id={processedLabelId}>Processed</span>
            </div>
            <ReactCompareSlider
                className={[
                    styles.compareSliderFrame,
                    isTransparentOutput ? styles.reviewImageFrameTransparent : "",
                ].filter(Boolean).join(" ")}
                aria-labelledby={`${originalLabelId} ${processedLabelId}`}
                aria-describedby={compareHelpId}
                keyboardIncrement={5}
                onPositionChange={updateHandleAccessibility}
                transition="160ms ease-out"
                handle={(
                    <ReactCompareSliderHandle
                        style={compareHandleStyle}
                        buttonStyle={compareHandleButtonStyle}
                        linesStyle={compareHandleLinesStyle}
                    />
                )}
                itemOne={(
                    <ReactCompareSliderImage
                        src={image.originalUrl}
                        alt={`${image.displayName} original`}
                        loading="lazy"
                        decoding="async"
                        style={{ objectFit: "contain" }}
                    />
                )}
                itemTwo={(
                    <ReactCompareSliderImage
                        src={image.processedUrl ?? ""}
                        alt={`${image.displayName} processed`}
                        loading="lazy"
                        decoding="async"
                        style={{ objectFit: "contain" }}
                    />
                )}
                defaultPosition={defaultPosition}
            />
        </div>
    );
}

function formatStatus(status: string): string {
    return status.replace(/_/g, " ");
}
