import { describe, expect, it, vi } from "vitest";
import { recoverStuckProcessingImages } from "../../lib/queue/recovery";

function makeDb({
    candidates = [],
    claimCount = 1,
    groupedStatuses = [{ status: "failed", _count: { _all: 1 } }],
    jobStatus = "processing",
}: {
    candidates?: Array<{
        id: string;
        jobId: string;
        originalUrl: string;
        shopifyMediaId: string;
        recoveryAttempts?: number;
        job: { shop: string; background: string };
    }>;
    claimCount?: number;
    groupedStatuses?: Array<{ status: string; _count: { _all: number } }>;
    jobStatus?: string;
}) {
    return {
        processedImage: {
            findMany: vi.fn().mockResolvedValue(
                candidates.map((candidate) => ({ recoveryAttempts: 0, ...candidate })),
            ),
            updateMany: vi.fn().mockResolvedValue({ count: claimCount }),
            groupBy: vi.fn().mockResolvedValue(groupedStatuses),
        },
        processingJob: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findUnique: vi.fn().mockResolvedValue({ status: jobStatus }),
            update: vi.fn().mockResolvedValue({}),
        },
    };
}

const now = new Date("2026-05-01T12:00:00.000Z");

describe("recoverStuckProcessingImages", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    it("resets stale processing images and re-enqueues them", async () => {
        const db = makeDb({
            candidates: [
                {
                    id: "img_1",
                    jobId: "job_1",
                    originalUrl: "https://cdn.shopify.com/image.jpg",
                    shopifyMediaId: "gid://shopify/MediaImage/1",
                    job: { shop: "unoir.myshopify.com", background: "atelier" },
                },
            ],
        });
        const enqueue = vi.fn().mockResolvedValue(undefined);

        const result = await recoverStuckProcessingImages({ db, enqueue, now });

        expect(result).toMatchObject({
            scanned: 1,
            recovered: 1,
            recoveredImageIds: ["img_1"],
            skipped: 0,
            failed: 0,
            failedImageIds: [],
            timestamp: now,
            reason: "stuck-processing-timeout",
        });
        expect(db.processedImage.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    status: "processing",
                    OR: [
                        { processingStartedAt: { lt: new Date("2026-05-01T11:45:00.000Z") } },
                        {
                            processingStartedAt: null,
                            updatedAt: { lt: new Date("2026-05-01T11:45:00.000Z") },
                        },
                    ],
                }),
            }),
        );
        expect(db.processedImage.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: "pending",
                    processingStartedAt: null,
                    recoveryAttempts: { increment: 1 },
                    lastRecoveryAt: now,
                    recoveryReason: "stuck-processing-timeout",
                }),
            }),
        );
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('"event":"stuck_processing_recovery"'));
        expect(db.processingJob.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "job_1", status: "processing" },
                data: { status: "queued" },
            }),
        );
        expect(enqueue).toHaveBeenCalledWith({
            jobId: "job_1",
            imageId: "img_1",
            shop: "unoir.myshopify.com",
            background: "atelier",
            sourceUrl: "https://cdn.shopify.com/image.jpg",
            shopifyMediaId: "gid://shopify/MediaImage/1",
        });
    });

    it("skips rows that were claimed by another worker first", async () => {
        const db = makeDb({
            claimCount: 0,
            candidates: [
                {
                    id: "img_1",
                    jobId: "job_1",
                    originalUrl: "https://cdn.shopify.com/image.jpg",
                    shopifyMediaId: "gid://shopify/MediaImage/1",
                    job: { shop: "unoir.myshopify.com", background: "white" },
                },
            ],
        });
        const enqueue = vi.fn();

        const result = await recoverStuckProcessingImages({ db, enqueue, now });

        expect(result).toMatchObject({ scanned: 1, recovered: 0, skipped: 1, failed: 0 });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it("fails stale rows with unknown background ids instead of falling back", async () => {
        const db = makeDb({
            candidates: [
                {
                    id: "img_1",
                    jobId: "job_1",
                    originalUrl: "https://cdn.shopify.com/image.jpg",
                    shopifyMediaId: "gid://shopify/MediaImage/1",
                    job: { shop: "unoir.myshopify.com", background: "mist" },
                },
            ],
        });
        const enqueue = vi.fn();

        const result = await recoverStuckProcessingImages({ db, enqueue, now });

        expect(result).toMatchObject({ scanned: 1, recovered: 0, skipped: 0, failed: 1 });
        expect(db.processedImage.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: "failed",
                    processingStartedAt: null,
                    lastRecoveryAt: now,
                    recoveryReason: "unknown-background",
                    errorMessage: "Unknown background option: mist",
                }),
            }),
        );
        expect(enqueue).not.toHaveBeenCalled();
        expect(db.processingJob.update).toHaveBeenCalledWith({
            where: { id: "job_1" },
            data: { status: "failed", completedAt: expect.any(Date) },
        });
    });

    it("hard-fails rows that exceed the recovery attempt cap", async () => {
        const db = makeDb({
            candidates: [
                {
                    id: "img_1",
                    jobId: "job_1",
                    originalUrl: "https://cdn.shopify.com/image.jpg",
                    shopifyMediaId: "gid://shopify/MediaImage/1",
                    recoveryAttempts: 3,
                    job: { shop: "unoir.myshopify.com", background: "white" },
                },
            ],
        });
        const enqueue = vi.fn();

        const result = await recoverStuckProcessingImages({ db, enqueue, now });

        expect(result).toMatchObject({
            scanned: 1,
            recovered: 0,
            failed: 1,
            failedImageIds: ["img_1"],
        });
        expect(db.processedImage.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: "failed",
                    processingStartedAt: null,
                    lastRecoveryAt: now,
                    recoveryReason: "max-recovery-attempts-exceeded",
                    errorMessage: "Processing could not complete after multiple recovery attempts.",
                }),
            }),
        );
        expect(enqueue).not.toHaveBeenCalled();
        expect(db.processingJob.update).toHaveBeenCalledWith({
            where: { id: "job_1" },
            data: { status: "failed", completedAt: expect.any(Date) },
        });
    });

    it("does not finalize a recovered job while other images are still pending", async () => {
        const db = makeDb({
            groupedStatuses: [
                { status: "failed", _count: { _all: 1 } },
                { status: "pending", _count: { _all: 1 } },
            ],
            candidates: [
                {
                    id: "img_1",
                    jobId: "job_1",
                    originalUrl: "https://cdn.shopify.com/image.jpg",
                    shopifyMediaId: "gid://shopify/MediaImage/1",
                    recoveryAttempts: 3,
                    job: { shop: "unoir.myshopify.com", background: "white" },
                },
            ],
        });
        const enqueue = vi.fn();

        await recoverStuckProcessingImages({ db, enqueue, now });

        expect(db.processingJob.update).not.toHaveBeenCalled();
    });

    it("restores rows to processing and fails startup when recovery enqueue fails", async () => {
        consoleError.mockClear();
        const db = makeDb({
            candidates: [
                {
                    id: "img_1",
                    jobId: "job_1",
                    originalUrl: "https://cdn.shopify.com/image.jpg",
                    shopifyMediaId: "gid://shopify/MediaImage/1",
                    job: { shop: "unoir.myshopify.com", background: "noir" },
                },
            ],
        });
        const enqueue = vi.fn().mockRejectedValue(new Error("redis down"));

        await expect(recoverStuckProcessingImages({ db, enqueue, now })).rejects.toThrow("redis down");
        expect(consoleError).toHaveBeenCalledWith(
            "[recovery] enqueue failed for image=img_1:",
            "redis down",
        );

        expect(db.processedImage.updateMany).toHaveBeenLastCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: "processing",
                    processingStartedAt: new Date("2026-05-01T11:45:00.000Z"),
                    errorMessage: "stuck-job recovery could not re-enqueue this image",
                }),
            }),
        );
    });
});