import { describe, expect, it } from "vitest";
import {
    getJobRouteNotice,
    getPickerErrorNotice,
    getPreviewErrorMessage,
    getRollbackResultNotice,
    getSafeImageMessage,
} from "../../lib/ui/failureCopy";

describe("failure copy", () => {
    it("covers processing dependency errors without suggesting anything published", () => {
        for (const code of ["queue-unavailable", "provider-unavailable", "storage-unavailable"] as const) {
            const notice = getPickerErrorNotice(code, { maxImagesPerJob: 50 });
            expect(notice?.copy).toMatch(/Nothing was processed/);
            expect(notice?.copy).toMatch(/published|new jobs are paused/i);
        }
    });

    it("keeps billing and worker outages framed as new-processing pauses", () => {
        expect(getPickerErrorNotice("billing-unavailable", { maxImagesPerJob: 50 })).toMatchObject({
            tone: "critical",
            title: "Billing check unavailable",
        });
        expect(getPickerErrorNotice("billing-unavailable", { maxImagesPerJob: 50 })?.copy).toContain(
            "Existing jobs remain available",
        );
        expect(getPickerErrorNotice("worker-unavailable", { maxImagesPerJob: 50 })?.copy).toContain(
            "New jobs are paused",
        );
    });

    it("explains validation failures before a job is created", () => {
        expect(getPickerErrorNotice("cap", { maxImagesPerJob: 50 })?.copy).toContain("up to 50 images");
        expect(getPickerErrorNotice("invalid", { maxImagesPerJob: 50 })?.copy).toContain("Nothing was processed or published");
        expect(getPickerErrorNotice("invalid-format", { maxImagesPerJob: 50 })?.copy).toContain("JPG and PNG");
    });

    it("returns no picker notice for errors that need custom route actions", () => {
        expect(getPickerErrorNotice("quota", { maxImagesPerJob: 50 })).toBeNull();
        expect(getPickerErrorNotice("finish-plan", { maxImagesPerJob: 50 })).toBeNull();
        expect(getPickerErrorNotice(null, { maxImagesPerJob: 50 })).toBeNull();
    });

    it("describes retry and rollback failures clearly", () => {
        expect(getJobRouteNotice("queue-unavailable")?.copy).toContain("retry when the queue recovers");
        expect(getJobRouteNotice("queue-partial")?.copy).toContain("stayed marked for retry");
        expect(getRollbackResultNotice("partial")?.copy).toContain("Original Shopify media is still in place");
        expect(getRollbackResultNotice("complete")?.copy).toContain("Originals stayed preserved");
    });

    it("maps preview publish and reprocess errors", () => {
        expect(getPreviewErrorMessage("unreviewed")).toContain("Nothing was published");
        expect(getPreviewErrorMessage("publish-in-progress")).toContain("Check again in a moment");
        expect(getPreviewErrorMessage("queue-unavailable")).toContain("Nothing was published");
        expect(getPreviewErrorMessage("invalid-input")).toContain("Nothing changed");
        expect(getPreviewErrorMessage("unknown")).toBeNull();
    });

    it("sanitizes per-image messages", () => {
        expect(getSafeImageMessage("failed_publish")).toContain("Retry publish when ready");
        expect(getSafeImageMessage("published")).toContain("follow-up update did not complete");
        expect(getSafeImageMessage("failed")).toContain("Nothing was published");
    });
});