import prisma from "../../app/db.server";
import { REMOVE_BG_REQUEST_TIMEOUT_MS } from "../ai/removeBg";
import { toBackgroundId, type BackgroundId } from "../backgrounds";
import { resolveSettledJobStatus } from "../jobs/status";
import type { BgRemovalJobData } from "./index";
import { emitTelemetryEvent, serializeError } from "../telemetry";

export const DEFAULT_STUCK_PROCESSING_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;
export const STUCK_PROCESSING_REASON = "stuck-processing-timeout";
/** Longer than the remove.bg client abort so an in-flight request can still finish. */
export const PROVIDER_IN_FLIGHT_MS = REMOVE_BG_REQUEST_TIMEOUT_MS + 30_000;

export type ProviderRecoveryDecision =
    | "finish-stored-result"
    | "wait-in-flight"
    | "fail-provider-unknown"
    | "call-provider";

/**
 * Stuck `processing` rows. A stored processed key is finished without another
 * remove.bg call. A provider timestamp inside the in-flight window means the
 * call may still be running, so wait. A timestamp outside that window with no
 * stored bytes means the call may already have happened — do not call again.
 * No timestamp means remove.bg was not started, so one call is safe.
 */
export function decideProviderRecovery(input: {
    processedKey: string | null;
    providerStartedAt: Date | null;
    now: Date;
    inFlightMs?: number;
}): ProviderRecoveryDecision {
    if (input.processedKey) return "finish-stored-result";
    if (input.providerStartedAt) {
        const age = input.now.getTime() - input.providerStartedAt.getTime();
        const inFlightMs = input.inFlightMs ?? PROVIDER_IN_FLIGHT_MS;
        return age < inFlightMs ? "wait-in-flight" : "fail-provider-unknown";
    }
    return "call-provider";
}

export const PROVIDER_UNKNOWN_FAILURE_MESSAGE =
    "Processing stopped after the image service was called. Automatic recovery will not call it again. Retry the image if you want another attempt.";

type RecoveryCandidate = {
    id: string;
    jobId: string;
    originalUrl: string;
    shopifyMediaId: string;
    recoveryAttempts: number;
    processedKey?: string | null;
    providerStartedAt?: Date | null;
    job: {
        shop: string;
        background: string;
    };
};

type RecoveryPrisma = {
    processedImage: {
        findMany(args: object): Promise<RecoveryCandidate[]>;
        updateMany(args: object): Promise<{ count: number }>;
        groupBy(args: object): Promise<Array<{ status: string; _count: { _all: number } }>>;
    };
    processingJob: {
        updateMany(args: object): Promise<{ count: number }>;
        findUnique(args: object): Promise<{ status: string } | null>;
        update(args: object): Promise<unknown>;
    };
};

export type EnqueueRecoveredImage = (data: BgRemovalJobData) => Promise<void>;

export type StuckProcessingRecoveryResult = {
    cutoff: Date;
    scanned: number;
    recovered: number;
    recoveredImageIds: string[];
    skipped: number;
    failed: number;
    failedImageIds: string[];
    timestamp: Date;
    reason: string;
    durationMs: number;
};

export async function recoverStuckProcessingImages({
    db: inputDb,
    enqueue,
    now = new Date(),
    staleAfterMs = DEFAULT_STUCK_PROCESSING_MS,
    maxRecoveryAttempts = DEFAULT_MAX_RECOVERY_ATTEMPTS,
}: {
    db?: RecoveryPrisma;
    enqueue: EnqueueRecoveredImage;
    now?: Date;
    staleAfterMs?: number;
    maxRecoveryAttempts?: number;
}): Promise<StuckProcessingRecoveryResult> {
    const startedAt = Date.now();
    const db = inputDb ?? (prisma as unknown as RecoveryPrisma);
    const cutoff = new Date(now.getTime() - staleAfterMs);
    const staleProcessingWhere = {
        OR: [
            { processingStartedAt: { lt: cutoff } },
            { processingStartedAt: null, updatedAt: { lt: cutoff } },
        ],
    };
    const candidates = await db.processedImage.findMany({
        where: {
            status: "processing",
            ...staleProcessingWhere,
            job: { status: { not: "canceled" } },
        },
        select: {
            id: true,
            jobId: true,
            originalUrl: true,
            shopifyMediaId: true,
            recoveryAttempts: true,
            processedKey: true,
            providerStartedAt: true,
            job: { select: { shop: true, background: true } },
        },
    });

    let recovered = 0;
    let skipped = 0;
    let failed = 0;
    const recoveredImageIds: string[] = [];
    const failedImageIds: string[] = [];
    const jobsToReconcile = new Set<string>();

    for (const image of candidates) {
        const decision = decideProviderRecovery({
            processedKey: image.processedKey ?? null,
            providerStartedAt: image.providerStartedAt ?? null,
            now,
        });
        if (decision === "finish-stored-result") {
            const update = await db.processedImage.updateMany({
                where: { id: image.id, status: "processing", processedKey: { not: null } },
                data: {
                    status: "processed",
                    processingStartedAt: null,
                    providerStartedAt: null,
                    errorMessage: null,
                },
            });
            if (update.count > 0) {
                recovered += 1;
                recoveredImageIds.push(image.id);
                jobsToReconcile.add(image.jobId);
            } else {
                skipped += 1;
            }
            continue;
        }
        if (decision === "wait-in-flight") {
            skipped += 1;
            continue;
        }
        if (decision === "fail-provider-unknown") {
            const update = await db.processedImage.updateMany({
                where: {
                    id: image.id,
                    status: "processing",
                    processedKey: null,
                    providerStartedAt: { not: null },
                },
                data: {
                    status: "failed",
                    processingStartedAt: null,
                    providerStartedAt: null,
                    lastRecoveryAt: now,
                    recoveryReason: "provider-call-not-replayed",
                    errorMessage: PROVIDER_UNKNOWN_FAILURE_MESSAGE,
                },
            });
            failed += update.count;
            if (update.count > 0) {
                emitTelemetryEvent("recovery_skipped_provider_replay", {
                    jobId: image.jobId,
                    imageId: image.id,
                    shop: image.job.shop,
                }, "warn");
                failedImageIds.push(image.id);
                jobsToReconcile.add(image.jobId);
            } else {
                skipped += 1;
            }
            continue;
        }

        if (image.recoveryAttempts >= maxRecoveryAttempts) {
            const update = await db.processedImage.updateMany({
                where: { id: image.id, status: "processing", ...staleProcessingWhere },
                data: {
                    status: "failed",
                    processingStartedAt: null,
                    lastRecoveryAt: now,
                    recoveryReason: "max-recovery-attempts-exceeded",
                    errorMessage: "Processing could not complete after multiple recovery attempts.",
                },
            });
            failed += update.count;
            if (update.count > 0) {
                emitTelemetryEvent("recovery_attempt_cap_exceeded", {
                    jobId: image.jobId,
                    imageId: image.id,
                    shop: image.job.shop,
                    recoveryAttempts: image.recoveryAttempts,
                    maxRecoveryAttempts,
                }, "error");
                failedImageIds.push(image.id);
                jobsToReconcile.add(image.jobId);
            }
            continue;
        }

        const background = toBackgroundId(image.job.background);
        if (!background) {
            const update = await db.processedImage.updateMany({
                where: { id: image.id, status: "processing", ...staleProcessingWhere },
                data: {
                    status: "failed",
                    processingStartedAt: null,
                    lastRecoveryAt: now,
                    recoveryReason: "unknown-background",
                    errorMessage: `Unknown background option: ${image.job.background}`,
                },
            });
            failed += update.count;
            if (update.count > 0) {
                emitTelemetryEvent("recovery_failed_unknown_background", {
                    jobId: image.jobId,
                    imageId: image.id,
                    shop: image.job.shop,
                    background: image.job.background,
                }, "error");
                failedImageIds.push(image.id);
                jobsToReconcile.add(image.jobId);
            }
            continue;
        }

        const claimed = await db.processedImage.updateMany({
            where: {
                id: image.id,
                status: "processing",
                processedKey: null,
                providerStartedAt: null,
                ...staleProcessingWhere,
                job: { status: { not: "canceled" } },
            },
            data: {
                status: "pending",
                processingStartedAt: null,
                recoveryAttempts: { increment: 1 },
                lastRecoveryAt: now,
                recoveryReason: STUCK_PROCESSING_REASON,
                errorMessage: "Processing was interrupted and will retry.",
            },
        });
        if (claimed.count === 0) {
            skipped += 1;
            continue;
        }

        await db.processingJob.updateMany({
            where: { id: image.jobId, status: "processing" },
            data: { status: "queued" },
        });
        emitTelemetryEvent("recovery_reenqueue_attempted", {
            jobId: image.jobId,
            imageId: image.id,
            shop: image.job.shop,
            recoveryAttempts: image.recoveryAttempts + 1,
        });

        try {
            await enqueue({
                jobId: image.jobId,
                imageId: image.id,
                shop: image.job.shop,
                background: background as BackgroundId,
                sourceUrl: image.originalUrl,
                shopifyMediaId: image.shopifyMediaId,
            });
            recovered += 1;
            recoveredImageIds.push(image.id);
        } catch (err) {
            await db.processedImage.updateMany({
                where: { id: image.id, status: "pending" },
                data: {
                    status: "processing",
                    processingStartedAt: cutoff,
                    errorMessage: "stuck-job recovery could not re-enqueue this image",
                },
            });
            console.error(
                `[recovery] enqueue failed for image=${image.id}:`,
                err instanceof Error ? err.message : String(err),
            );
            emitTelemetryEvent("recovery_enqueue_failed", {
                jobId: image.jobId,
                imageId: image.id,
                shop: image.job.shop,
                ...serializeError(err),
            }, "error");
            throw err;
        }
    }

    for (const jobId of jobsToReconcile) {
        await reconcileProcessingJob(db, jobId);
    }

    const result = {
        cutoff,
        scanned: candidates.length,
        recovered,
        recoveredImageIds,
        skipped,
        failed,
        failedImageIds,
        timestamp: now,
        reason: STUCK_PROCESSING_REASON,
        durationMs: Date.now() - startedAt,
    };

    if (result.scanned > 0) {
        emitTelemetryEvent("stuck_processing_recovery", {
            cutoff: result.cutoff,
            scanned: result.scanned,
            recovered: result.recovered,
            skipped: result.skipped,
            failed: result.failed,
            reason: result.reason,
            durationMs: result.durationMs,
        }, result.failed > 0 ? "warn" : "info");
    }

    return result;
}

async function reconcileProcessingJob(db: RecoveryPrisma, jobId: string): Promise<void> {
    const counts = await db.processedImage.groupBy({
        by: ["status"],
        where: { jobId },
        _count: { _all: true },
    });
    const map = Object.fromEntries(counts.map((count) => [count.status, count._count._all]));
    const stillProcessing = (map.pending ?? 0) + (map.processing ?? 0);
    if (stillProcessing > 0) return;

    await db.processingJob.updateMany({
        where: { id: jobId, status: { in: ["queued", "processing"] } },
        data: {
            status: resolveSettledJobStatus(map),
            completedAt: new Date(),
        },
    });
}