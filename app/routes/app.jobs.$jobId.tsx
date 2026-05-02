import type { LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useLoaderData, useRevalidator, useSearchParams } from "@remix-run/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
    Page,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { AppNotice } from "../components/AppNotice";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getBackgroundOption, toBackgroundId } from "@lib/backgrounds";
import { getPublicUrl } from "@lib/storage";
import { getJobRouteNotice, getRollbackResultNotice } from "@lib/ui/failureCopy";
import styles from "../styles/studio.module.css";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const jobId = params.jobId;
    if (!jobId) throw new Response("Not found", { status: 404 });

    const job = await prisma.processingJob.findFirst({
        where: { id: jobId, shop: session.shop },
        include: { images: { orderBy: { createdAt: "asc" } } },
    });
    if (!job) throw new Response("Not found", { status: 404 });

    // Resolve display URLs at read time. Prefer the processed S3 key
    // and fall back to the original Shopify URL while pending.
    const images = await Promise.all(
        job.images.map(async (img, index) => {
            const displayUrl = img.processedKey
                ? await getPublicUrl(img.processedKey)
                : img.originalUrl;
            return { ...img, displayUrl, displayName: `Image ${index + 1}` };
        }),
    );

    const counts = images.reduce<Record<string, number>>((acc, img) => {
        acc[img.status] = (acc[img.status] ?? 0) + 1;
        return acc;
    }, {});

    return { job: { ...job, images }, counts };
};

export default function JobStatusRoute() {
    const { job, counts } = useLoaderData<typeof loader>();
    const revalidator = useRevalidator();
    const [searchParams] = useSearchParams();
    const [confirmRollback, setConfirmRollback] = useState(false);
    const rollbackButtonRef = useRef<HTMLButtonElement | null>(null);
    const rollbackCancelRef = useRef<HTMLButtonElement | null>(null);
    const rollbackDialogRef = useRef<HTMLDivElement | null>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    const total = job.totalImages || 1;
    const done =
        (counts.processed ?? 0) +
        (counts.approved ?? 0) +
        (counts.rejected ?? 0) +
        (counts.published ?? 0) +
        (counts.failed_publish ?? 0) +
        (counts.failed ?? 0);
    const progress = Math.min(100, Math.round((done / total) * 100));
    const rollbackable =
        (counts.published ?? 0) +
        (counts.publishing ?? 0) +
        (counts.failed_publish ?? 0);
    const openStudioCount =
        (counts.processed ?? 0) +
        (counts.approved ?? 0) +
        (counts.rejected ?? 0) +
        (counts.publishing ?? 0) +
        (counts.failed_publish ?? 0) +
        (counts.published ?? 0);
    const heroImage = job.images[0];
    const mosaicImages = job.images.slice(1, 6);
    const readyCount = (counts.processed ?? 0) + (counts.approved ?? 0);
    const failedCount = (counts.failed ?? 0) + (counts.failed_publish ?? 0);
    const pendingCount = counts.pending ?? 0;
    const processingCount = counts.processing ?? 0;
    const state = getJobState({
        jobStatus: job.status,
        totalImages: job.totalImages,
        background: job.background,
        pendingCount,
        processingCount,
        done,
        readyCount,
        failedCount,
    });
    const showMetrics =
        state.showMetrics && (done > 0 || readyCount > 0 || failedCount > 0);
    const shouldPoll = state.shouldPoll;
    const rollbackResult = searchParams.get("rollback");
    const routeError = searchParams.get("error");
    const rollbackNotice = getRollbackResultNotice(rollbackResult);
    const routeNotice = getJobRouteNotice(routeError);

    const closeRollbackDialog = () => {
        setConfirmRollback(false);
        const target = previousFocusRef.current ?? rollbackButtonRef.current;
        window.requestAnimationFrame(() => target?.focus());
    };

    const onRollbackDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeRollbackDialog();
            return;
        }
        if (event.key !== "Tab") return;

        const focusable = rollbackDialogRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    useEffect(() => {
        if (!shouldPoll) return;
        const tick = () => {
            if (!document.hidden) revalidator.revalidate();
        };
        const id = setInterval(tick, 2500);
        return () => clearInterval(id);
    }, [shouldPoll, revalidator]);

    useEffect(() => {
        const onVisible = () => {
            if (!document.hidden && shouldPoll) revalidator.revalidate();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, [shouldPoll, revalidator]);

    useEffect(() => {
        if (!confirmRollback) return;
        previousFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        window.requestAnimationFrame(() => rollbackCancelRef.current?.focus());
    }, [confirmRollback]);

    return (
        <Page
            backAction={{ url: "/app/picker" }}
            title="Studio job"
        >
            <TitleBar title="Studio job" />
            <div className={styles.lightSection}>
                {rollbackNotice && (
                    <AppNotice tone={rollbackNotice.tone} title={rollbackNotice.title}>
                        <p>{rollbackNotice.copy}</p>
                    </AppNotice>
                )}
                {routeNotice && (
                    <AppNotice tone={routeNotice.tone} title={routeNotice.title}>
                        <p>{routeNotice.copy}</p>
                    </AppNotice>
                )}
                {job.status === "failed" && (counts.processed ?? 0) === 0 && (
                    <AppNotice tone="critical" title="Job failed">
                        <p>All images failed to process. Originals are preserved; retry failed images when processing is available.</p>
                    </AppNotice>
                )}

                <section className={styles.launchShell}>
                    <div className={styles.launchCopy}>
                        <div>
                            <div className={styles.eyebrow}>{state.label}</div>
                            <h2 className={styles.launchTitle}>{state.title}</h2>
                            <p className={styles.launchSummary}>
                                {state.subtitle}
                                {state.hint && (
                                    <span className={styles.launchHint}>{state.hint}</span>
                                )}
                            </p>
                        </div>

                        {(state.showProgress || showMetrics) && (
                            <div className={styles.progressBlock}>
                                {state.showProgress && (
                                    <div className={styles.progressRow}>
                                        <div
                                            className={styles.progressTrack}
                                            aria-label="Processing progress"
                                            aria-valuemin={0}
                                            aria-valuemax={total}
                                            aria-valuenow={Math.min(done, total)}
                                            role="progressbar"
                                        >
                                            <div
                                                className={styles.progressFill}
                                                style={{ width: `${progress}%` }}
                                            />
                                        </div>
                                        <span className={styles.progressMeta}>
                                            {Math.min(done, total)} of {total}
                                        </span>
                                    </div>
                                )}
                                {showMetrics && (
                                    <div className={styles.metrics}>
                                        <div className={`${styles.metric} ${done === 0 ? styles.metricZero : ""}`}>
                                            <span className={styles.metricValue}>{done}</span>
                                            <span className={styles.metricLabel}>Complete</span>
                                        </div>
                                        <div className={`${styles.metric} ${readyCount === 0 ? styles.metricZero : ""}`}>
                                            <span className={styles.metricValue}>{readyCount}</span>
                                            <span className={styles.metricLabel}>Ready</span>
                                        </div>
                                        <div className={`${styles.metric} ${failedCount === 0 ? styles.metricZero : ""}`}>
                                            <span className={styles.metricValue}>{failedCount}</span>
                                            <span className={styles.metricLabel}>Needs attention</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className={styles.launchActions}>
                            {state.kind === "completed" && openStudioCount > 0 && (
                                <Link
                                    className={styles.primaryAction}
                                    to={`/app/jobs/${job.id}/preview`}
                                >
                                    Open Studio →
                                </Link>
                            )}
                            {state.kind === "canceled" && openStudioCount > 0 && (
                                <Link
                                    className={styles.primaryAction}
                                    to={`/app/jobs/${job.id}/preview`}
                                >
                                    Review finished images
                                </Link>
                            )}
                            {(state.kind === "completed" ||
                                state.kind === "canceled") && (
                                    <Link className={styles.secondaryAction} to="/app/picker">
                                        Select More
                                    </Link>
                                )}
                            {state.canCancel && (
                                <Form method="post" action={`/app/jobs/${job.id}/cancel`}>
                                    <button className={styles.quietAction} type="submit">
                                        Cancel
                                    </button>
                                </Form>
                            )}
                            {failedCount > 0 && (
                                <Form method="post" action={`/app/jobs/${job.id}/retry`}>
                                    <button className={styles.secondaryAction} type="submit">
                                        Retry Failed ({failedCount})
                                    </button>
                                </Form>
                            )}
                            {rollbackable > 0 && (
                                <button
                                    ref={rollbackButtonRef}
                                    className={styles.dangerAction}
                                    type="button"
                                    onClick={() => setConfirmRollback(true)}
                                >
                                    Roll Back ({rollbackable})
                                </button>
                            )}
                        </div>
                    </div>

                    <div className={styles.visualStage}>
                        {heroImage && (
                            <div className={styles.heroImageFrame}>
                                <img
                                    className={styles.heroImage}
                                    src={heroImage.displayUrl}
                                    alt={getImageAlt(heroImage.displayName, heroImage.status)}
                                    loading="eager"
                                    decoding="async"
                                />
                            </div>
                        )}
                        <div className={styles.mosaic}>
                            {(mosaicImages.length > 0 ? mosaicImages : job.images).map((img) => (
                                <div
                                    className={`${styles.mosaicTile} ${styles[getImageStateClass(img.status)]}`}
                                    key={img.id}
                                >
                                    <img
                                        src={img.displayUrl}
                                        alt={getImageAlt(img.displayName, img.status)}
                                        loading="lazy"
                                        decoding="async"
                                    />
                                    <span
                                        className={styles.thumbnailState}
                                        aria-hidden="true"
                                        title={formatStatus(img.status)}
                                    >
                                        {getImageStateGlyph(img.status)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className={styles.outputShelf}>
                    <div className={styles.outputShelfHeader}>
                        <span className={styles.subtleLabel}>Image set</span>
                        <span className={styles.outputCount}>
                            {job.images.length} {job.images.length === 1 ? "image" : "images"}
                        </span>
                    </div>
                    <div className={styles.imageGallery}>
                        {job.images.map((img) => (
                            <div
                                className={`${styles.imageTile} ${styles[getImageStateClass(img.status)]}`}
                                key={img.id}
                            >
                                <img
                                    src={img.displayUrl}
                                    alt={getImageAlt(img.displayName, img.status)}
                                    loading="lazy"
                                    decoding="async"
                                />
                                <span
                                    className={styles.thumbnailState}
                                    aria-hidden="true"
                                    title={formatStatus(img.status)}
                                >
                                    {getImageStateGlyph(img.status)}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
            {confirmRollback && (
                <div className={styles.modalOverlay} onKeyDown={onRollbackDialogKeyDown}>
                    <div
                        ref={rollbackDialogRef}
                        className={styles.confirmDialog}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="rollback-title"
                    >
                        <h3 id="rollback-title" className={styles.confirmTitle}>
                            Roll back published images?
                        </h3>
                        <p className={styles.confirmCopy}>
                            This removes {rollbackable} published image
                            {rollbackable === 1 ? "" : "s"} from Shopify and returns them
                            to review.
                        </p>
                        <div className={styles.confirmActions}>
                            <button
                                ref={rollbackCancelRef}
                                className={styles.secondaryAction}
                                type="button"
                                onClick={closeRollbackDialog}
                            >
                                Cancel
                            </button>
                            <Form method="post" action={`/app/jobs/${job.id}/rollback`}>
                                <button className={styles.dangerAction} type="submit">
                                    Confirm Rollback
                                </button>
                            </Form>
                        </div>
                    </div>
                </div>
            )}
        </Page>
    );
}

type JobState = {
    kind: "queued" | "processing" | "completed" | "failed" | "canceled" | "publishing";
    label: string;
    title: string;
    subtitle: string;
    hint?: string;
    showProgress: boolean;
    showMetrics: boolean;
    canCancel: boolean;
    shouldPoll: boolean;
};

function getJobState(input: {
    jobStatus: string;
    totalImages: number;
    background: string;
    pendingCount: number;
    processingCount: number;
    done: number;
    readyCount: number;
    failedCount: number;
}): JobState {
    const background = toBackgroundId(input.background);
    const backgroundLabel = background ? getBackgroundOption(background).label : "Unknown background";
    const title = `${input.totalImages} ${input.totalImages === 1 ? "image" : "images"} on ${backgroundLabel}`;

    if (input.jobStatus === "canceled") {
        return {
            kind: "canceled",
            label: "canceled",
            title,
            subtitle: input.done > 0
                ? "Processing was canceled. Finished images remain available for review."
                : "Processing was canceled.",
            showProgress: false,
            showMetrics: input.done > 0 || input.failedCount > 0,
            canCancel: false,
            shouldPoll: false,
        };
    }

    if (input.jobStatus === "publishing") {
        return {
            kind: "publishing",
            label: "publishing",
            title,
            subtitle: "Publishing approved images back to Shopify with originals preserved.",
            hint: "Shopify may take a moment to finish ingesting the new media.",
            showProgress: true,
            showMetrics: true,
            canCancel: false,
            shouldPoll: true,
        };
    }

    const activeCount = input.pendingCount + input.processingCount;
    if (activeCount > 0) {
        if (input.processingCount > 0 || input.done > 0 || input.jobStatus === "processing") {
            return {
                kind: "processing",
                label: "standardizing",
                title,
                subtitle: "Applying the selected finish and preparing review-ready outputs.",
                hint: "You can keep this page open while each image moves into review.",
                showProgress: true,
                showMetrics: false,
                canCancel: true,
                shouldPoll: true,
            };
        }

        return {
            kind: "queued",
            label: "queued",
            title,
            subtitle: "Your images are queued and will start standardizing shortly.",
            showProgress: false,
            showMetrics: false,
            canCancel: true,
            shouldPoll: true,
        };
    }

    if (input.jobStatus === "failed" && input.readyCount === 0) {
        return {
            kind: "failed",
            label: "needs attention",
            title,
            subtitle: "We could not process these images. Originals are preserved, and failed images can be retried.",
            showProgress: false,
            showMetrics: input.failedCount > 0,
            canCancel: false,
            shouldPoll: false,
        };
    }

    return {
        kind: "completed",
        label: input.jobStatus === "published" ? "published" : "completed",
        title,
        subtitle: input.readyCount > 0
            ? "Your images are ready for review before anything changes in Shopify."
            : "Your job is complete.",
        showProgress: false,
        showMetrics: true,
        canCancel: false,
        shouldPoll: false,
    };
}

function formatStatus(status: string): string {
    return status.replace(/_/g, " ");
}

function getImageAlt(displayName: string, status: string): string {
    return `${displayName}, ${formatStatus(status)}`;
}

function getImageStateClass(status: string): string {
    if (
        status === "processed" ||
        status === "approved" ||
        status === "published"
    ) {
        return "imageStateReady";
    }
    if (status === "failed" || status === "failed_publish") {
        return "imageStateAttention";
    }
    if (status === "processing" || status === "publishing") {
        return "imageStateActive";
    }
    return "imageStateMuted";
}

function getImageStateGlyph(status: string): string {
    if (
        status === "processed" ||
        status === "approved" ||
        status === "published"
    ) {
        return "✓";
    }
    if (status === "failed" || status === "failed_publish") return "!";
    if (status === "processing" || status === "publishing") return "•";
    return "";
}
