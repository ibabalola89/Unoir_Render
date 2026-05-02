/**
 * BullMQ worker — runs as a separate process (`npm run worker`).
 *
 * Per image:
 *   1. Backup the original to S3 (rollback source-of-truth, Phase 5).
 *   2. Call remove.bg.
 *   3. Upload processed bytes to S3.
 *   4. Persist S3 keys (NOT URLs — URLs are resolved at read time).
 *   5. When all images in a job settle, mark the job done.
 *
 * Retry policy: BullMQ owns retries. We mark the row `processing` while
 * a job is running and only flip it to `processed` / `failed` from the
 * worker's terminal events (`completed` / `failed`).
 */

import "dotenv/config";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import prisma from "../../app/db.server";
import { getBackgroundOutputExtension, UnknownBackgroundError } from "../backgrounds";
import { QUEUE_NAMES, getRedisConnection, validateRedisUrl } from "./connection";
import { enqueueBgRemoval, type BgRemovalJobData } from "./index";
import { recoverStuckProcessingImages } from "./recovery";
import { checkRemoveBgAccount, removeBackground, RemoveBgError } from "../ai/removeBg";
import { resolveSettledJobStatus } from "../jobs/status";
import {
    buildOriginalKey,
    buildProcessedKey,
    checkStorageBucket,
    uploadBuffer,
    uploadFromUrl,
} from "../storage";
import { emitTelemetryEvent, serializeError } from "../telemetry";

async function isImageCanceled(imageId: string): Promise<boolean> {
    const image = await prisma.processedImage.findUnique({
        where: { id: imageId },
        select: {
            status: true,
            job: { select: { status: true } },
        },
    });
    return !image || image.status === "canceled" || image.job.status === "canceled";
}

async function processImage(job: Job<BgRemovalJobData>): Promise<void> {
    const { jobId, imageId, background, sourceUrl } = job.data;

    if (await isImageCanceled(imageId)) return;

    await prisma.processingJob.updateMany({
        where: { id: jobId, status: "queued" },
        data: { status: "processing" },
    });

    const claim = await prisma.processedImage.updateMany({
        where: {
            id: imageId,
            status: "pending",
            job: { status: { not: "canceled" } },
        },
        data: { status: "processing", processingStartedAt: new Date(), errorMessage: null },
    });
    if (claim.count === 0) return;

    // 1. Backup original (idempotent overwrite).
    const original = await uploadFromUrl({
        key: buildOriginalKey(jobId, imageId),
        sourceUrl,
    });
    if (await isImageCanceled(imageId)) return;

    // 2. remove.bg
    const result = await removeBackground({ imageUrl: sourceUrl, background });
    if (await isImageCanceled(imageId)) return;

    // 3. Upload processed bytes.
    const ext = getBackgroundOutputExtension(background);
    const processed = await uploadBuffer({
        key: buildProcessedKey(jobId, imageId, ext),
        body: result.imageBuffer,
        contentType: result.contentType,
    });

    // 4. Persist keys.
    await prisma.processedImage.updateMany({
        where: {
            id: imageId,
            status: "processing",
            job: { status: { not: "canceled" } },
        },
        data: {
            status: "processed",
            processingStartedAt: null,
            originalBackupKey: original.key,
            processedKey: processed.key,
        },
    });
}

async function maybeFinalizeJob(jobId: string): Promise<void> {
    const counts = await prisma.processedImage.groupBy({
        by: ["status"],
        where: { jobId },
        _count: { _all: true },
    });
    const map = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
    const stillProcessing = (map.pending ?? 0) + (map.processing ?? 0);
    if (stillProcessing > 0) return;

    // Only set the job status while it's still in a processing-phase state.
    // Once a user starts approving/rejecting/publishing, the lifecycle moves
    // beyond the worker's concern — don't clobber it.
    const job = await prisma.processingJob.findUnique({
        where: { id: jobId },
        select: { status: true },
    });
    if (!job || (job.status !== "queued" && job.status !== "processing")) return;

    const newStatus = resolveSettledJobStatus(map);
    await prisma.processingJob.update({
        where: { id: jobId },
        data: { status: newStatus, completedAt: new Date() },
    });
}

export function startWorker(): Worker<BgRemovalJobData> {
    // Track image IDs this worker is actively processing so SIGTERM can
    // reset only OUR in-flight rows. Critical when more than one worker is
    // running: a global `processing → pending` flip would clobber other
    // workers' active rows and create duplicate work.
    const inFlight = new Set<string>();

    const worker = new Worker<BgRemovalJobData>(
        QUEUE_NAMES.bgRemoval,
        async (job) => {
            inFlight.add(job.data.imageId);
            try {
                await processImage(job);
            } catch (err) {
                // Non-retryable remove.bg errors (4xx other than 429) — tell
                // BullMQ to give up immediately instead of burning retries.
                if (
                    err instanceof UnknownBackgroundError ||
                    (err instanceof RemoveBgError && !err.retryable)
                ) {
                    throw new UnrecoverableError(err.message);
                }
                throw err;
            } finally {
                inFlight.delete(job.data.imageId);
            }
        },
        {
            connection: getRedisConnection(),
            concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
        },
    );

    // Expose for shutdown handler.
    (worker as unknown as { __inFlight: Set<string> }).__inFlight = inFlight;

    worker.on("ready", () => console.log("[worker] ready"));

    // Terminal failure: BullMQ has exhausted retries OR error was non-retryable.
    worker.on("failed", async (job, err) => {
        if (!job) {
            console.error("[worker] job failed (no job ref):", err.message);
            return;
        }
        const isFatal =
            err instanceof UnrecoverableError ||
            (err instanceof RemoveBgError && !err.retryable);
        const attemptsLeft =
            (job.opts.attempts ?? 1) - (job.attemptsMade ?? 0);
        const shouldFinalize = isFatal || attemptsLeft <= 0;
        try {
            const update = await prisma.processedImage.updateMany({
                where: {
                    id: job.data.imageId,
                    status: { not: "canceled" },
                    job: { status: { not: "canceled" } },
                },
                data: {
                    status: shouldFinalize ? "failed" : "pending",
                    processingStartedAt: null,
                    errorMessage: err.message,
                },
            });
            if (shouldFinalize && update.count > 0) await maybeFinalizeJob(job.data.jobId);
        } catch (dbErr) {
            console.error("[worker] failed to persist failure state:", dbErr);
        }
        console.error(`[worker] job ${job.id} failed:`, err.message);
        emitTelemetryEvent("worker_job_failed", {
            jobId: job.data.jobId,
            imageId: job.data.imageId,
            shop: job.data.shop,
            attemptsMade: job.attemptsMade,
            attemptsLeft,
            finalized: shouldFinalize,
            fatal: isFatal,
            ...serializeError(err),
        }, shouldFinalize ? "error" : "warn");
    });

    worker.on("completed", async (job) => {
        try {
            await maybeFinalizeJob(job.data.jobId);
        } catch (err) {
            console.error("[worker] failed to finalize job:", err);
        }
    });

    worker.on("error", (err) => {
        console.error("[worker] error:", err);
        emitTelemetryEvent("worker_runtime_error", serializeError(err), "error");
    });

    return worker;
}

/** Fail fast at boot if the worker is misconfigured. */
function assertWorkerEnv(): void {
    const required = [
        "REMOVE_BG_API_KEY",
        "REDIS_URL",
        "STORAGE_BUCKET",
        "STORAGE_REGION",
    ];
    const missing = required.filter((k) => !process.env[k]);
    if (!process.env.STORAGE_ACCESS_KEY && !process.env.STORAGE_ACCESS_KEY_ID) {
        missing.push("STORAGE_ACCESS_KEY or STORAGE_ACCESS_KEY_ID");
    }
    if (!process.env.STORAGE_SECRET_KEY && !process.env.STORAGE_SECRET_ACCESS_KEY) {
        missing.push("STORAGE_SECRET_KEY or STORAGE_SECRET_ACCESS_KEY");
    }
    if (!process.env.STORAGE_ENDPOINT && !process.env.STORAGE_ACCOUNT_ID) {
        missing.push("STORAGE_ENDPOINT or STORAGE_ACCOUNT_ID");
    }
    if (missing.length > 0) {
        console.error(
            `[worker] missing required env: ${missing.join(", ")}`,
        );
        emitTelemetryEvent("worker_startup_failed", {
            reason: "missing_env",
            missing,
        }, "error");
        process.exit(1);
    }
    try {
        validateRedisUrl();
    } catch (err) {
        console.error(`[worker] ${err instanceof Error ? err.message : String(err)}`);
        emitTelemetryEvent("worker_startup_failed", {
            reason: "redis_url_invalid",
            ...serializeError(err),
        }, "error");
        process.exit(1);
    }
}

async function assertWorkerDependencies(): Promise<void> {
    try {
        await Promise.all([
            checkRemoveBgAccount(),
            checkStorageBucket(),
        ]);
    } catch (err) {
        console.error(
            `[worker] dependency check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        emitTelemetryEvent("worker_dependency_check_failed", serializeError(err), "error");
        process.exit(1);
    }
}

async function shutdown(worker: Worker<BgRemovalJobData>): Promise<void> {
    console.log("[worker] shutting down…");
    // Snapshot in-flight image IDs BEFORE close. After worker.close() the
    // Set is drained as jobs settle; we want the rows we owned at SIGTERM.
    const inFlight = (worker as unknown as { __inFlight?: Set<string> }).__inFlight;
    const owned = inFlight ? Array.from(inFlight) : [];
    try {
        await worker.close();
    } catch (err) {
        console.error("[worker] error during worker.close:", err);
    }
    // Reset only OUR in-flight rows. A global flip would clobber rows owned
    // by other workers when running more than one process.
    if (owned.length > 0) {
        try {
            const reset = await prisma.processedImage.updateMany({
                where: { id: { in: owned }, status: "processing" },
                data: { status: "pending", processingStartedAt: null },
            });
            if (reset.count > 0) {
                console.log(`[worker] reset ${reset.count} in-flight rows to pending`);
            }
        } catch (err) {
            console.error("[worker] error resetting in-flight rows:", err);
        }
    }
    try {
        await prisma.$disconnect();
    } catch (err) {
        console.error("[worker] error during prisma.$disconnect:", err);
    }
    process.exit(0);
}

// Boot the worker. This file is the entrypoint of `npm run worker`; it has no
// other importers, so we can safely run on import.
async function main(): Promise<void> {
    assertWorkerEnv();
    await assertWorkerDependencies();
    const recovery = await recoverStuckProcessingImages({ enqueue: enqueueBgRemoval });
    if (recovery.scanned > 0) {
        console.log(
            `[worker] recovered stuck processing images: recovered=${recovery.recovered} failed=${recovery.failed} skipped=${recovery.skipped}`,
        );
        emitTelemetryEvent("worker_recovery_completed", {
            scanned: recovery.scanned,
            recovered: recovery.recovered,
            failed: recovery.failed,
            skipped: recovery.skipped,
            durationMs: recovery.durationMs,
        }, recovery.failed > 0 ? "warn" : "info");
    }
    const worker = startWorker();
    process.on("SIGTERM", () => void shutdown(worker));
    process.on("SIGINT", () => void shutdown(worker));
}

void main().catch((err) => {
    console.error(`[worker] startup failed: ${err instanceof Error ? err.message : String(err)}`);
    emitTelemetryEvent("worker_startup_failed", {
        reason: "unhandled_startup_error",
        ...serializeError(err),
    }, "error");
    process.exit(1);
});
