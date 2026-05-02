export type NoticeTone = "success" | "warning" | "critical";

export interface FailureNotice {
    tone: NoticeTone;
    title: string;
    copy: string;
}

export function getPickerErrorNotice(
    error: string | null,
    options: { maxImagesPerJob: number },
): FailureNotice | null {
    switch (error) {
        case "billing-unavailable":
            return {
                tone: "critical",
                title: "Billing check unavailable",
                copy: "New processing is paused until Shopify confirms your plan. Existing jobs remain available.",
            };
        case "shopify-unavailable":
            return {
                tone: "critical",
                title: "Shopify product images are temporarily unavailable",
                copy: "We couldn't load image sources from Shopify. Nothing was processed or published; try again in a moment.",
            };
        case "queue-unavailable":
            return {
                tone: "critical",
                title: "Processing could not start",
                copy: "We couldn't start a new job. Nothing was processed or published; try again shortly.",
            };
        case "worker-unavailable":
            return {
                tone: "critical",
                title: "Processing is temporarily offline",
                copy: "New jobs are paused while processing catches up. Existing jobs remain available.",
            };
        case "provider-unavailable":
            return {
                tone: "critical",
                title: "Image processing is temporarily unavailable",
                copy: "New processing is paused while the image service recovers. Nothing was processed or published; try again shortly.",
            };
        case "storage-unavailable":
            return {
                tone: "critical",
                title: "Storage is unavailable",
                copy: "We couldn't verify image storage, so new jobs are paused. Nothing was processed or published.",
            };
        case "invalid-background":
            return {
                tone: "critical",
                title: "Finish unavailable",
                copy: "Choose one of the curated Unoir finishes and try again.",
            };
        case "empty":
            return {
                tone: "warning",
                title: "No images selected",
                copy: "Select at least one eligible JPG or PNG product image before starting a job.",
            };
        case "cap":
            return {
                tone: "warning",
                title: "Too many images selected",
                copy: `Jobs can include up to ${options.maxImagesPerJob} images. Nothing was processed; reduce the selection and try again.`,
            };
        case "invalid":
            return {
                tone: "critical",
                title: "Selection could not be verified",
                copy: "We could not confirm every selected image belongs to this shop. Nothing was processed or published; refresh the picker and try again.",
            };
        case "invalid-format":
            return {
                tone: "warning",
                title: "Unsupported image format",
                copy: "Unoir processes JPG and PNG product images only. Nothing was processed; adjust the selection and try again.",
            };
        default:
            return null;
    }
}

export function getJobRouteNotice(error: string | null): FailureNotice | null {
    switch (error) {
        case "rollback-in-progress":
            return {
                tone: "warning",
                title: "Rollback already in progress",
                copy: "Another publish or rollback action is still settling. Check again in a moment.",
            };
        case "queue-unavailable":
            return {
                tone: "critical",
                title: "Retry could not start",
                copy: "Processing is temporarily unavailable. Failed images stayed unchanged; retry when the queue recovers.",
            };
        case "queue-partial":
            return {
                tone: "warning",
                title: "Some retries could not start",
                copy: "Images accepted by the queue will continue processing. Images that could not be queued stayed marked for retry.",
            };
        default:
            return null;
    }
}

export function getRollbackResultNotice(result: string | null): FailureNotice | null {
    switch (result) {
        case "complete":
            return {
                tone: "success",
                title: "Rollback complete",
                copy: "Unoir-published images were removed from Shopify. Originals stayed preserved.",
            };
        case "partial":
            return {
                tone: "warning",
                title: "Rollback needs attention",
                copy: "Some Unoir-published images could not be removed. Original Shopify media is still in place; try rollback again in a moment.",
            };
        default:
            return null;
    }
}

export function getPreviewErrorMessage(error: string | null): string | null {
    switch (error) {
        case "unreviewed":
            return "Approve or reject every processed image before publishing. Nothing was published.";
        case "publish-in-progress":
            return "Publishing is already in progress. Check again in a moment.";
        case "nothing-approved":
            return "Approve at least one image before publishing. Nothing was published.";
        case "queue-unavailable":
            return "Reprocess could not start because processing is temporarily unavailable. Nothing was published.";
        case "invalid-input":
            return "That reprocess request could not be verified. Nothing changed.";
        default:
            return null;
    }
}

export function getSafeImageMessage(status: string): string {
    if (status === "failed_publish") {
        return "Shopify could not finish publishing this image. Retry publish when ready.";
    }
    if (status === "published") {
        return "The image was published, but one follow-up update did not complete.";
    }
    return "This image needs attention. Nothing was published for it; try again in a moment.";
}