/**
 * Producer-side queue API. Imported by Remix routes.
 * The actual worker lives in `lib/queue/worker.ts` and runs as a separate process.
 */

import { Queue, type JobsOptions } from "bullmq";
import type { BackgroundId } from "../backgrounds";
import { QUEUE_NAMES, getRedisConnection } from "./connection";

export interface BgRemovalJobData {
    /** ProcessingJob.id (Prisma) */
    jobId: string;
    /** ProcessedImage.id (Prisma) */
    imageId: string;
    /** Shopify shop domain (for the worker to authenticate offline session). */
    shop: string;
    /** Fixed curated finish option. */
    background: BackgroundId;
    /** Source URL the worker should download bytes from. */
    sourceUrl: string;
    /** Shopify MediaImage GID — used later for publish. */
    shopifyMediaId: string;
}

let _queue: Queue<BgRemovalJobData> | null = null;

export function getBgRemovalQueue(): Queue<BgRemovalJobData> {
    if (_queue) return _queue;
    _queue = new Queue<BgRemovalJobData>(QUEUE_NAMES.bgRemoval, {
        connection: getRedisConnection(),
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
            removeOnFail: { age: 60 * 60 * 24 * 7 },
        },
    });
    return _queue;
}

const FINISHED_QUEUE_JOB_STATES = new Set(["completed", "failed", "unknown"]);

/**
 * BullMQ keeps completed and failed jobs when `removeOnComplete` /
 * `removeOnFail` still retain them. `Queue.add` with the same job id does
 * not throw and does not requeue — it emits `duplicated` and returns.
 * Finished jobs must be removed before a merchant retry or recovery add.
 * Live states (waiting, active, delayed, paused) are left alone so a second
 * caller cannot start parallel remove.bg work.
 */
export function isFinishedQueueJobState(state: string): boolean {
    return FINISHED_QUEUE_JOB_STATES.has(state);
}

export async function enqueueBgRemoval(
    data: BgRemovalJobData,
    opts?: JobsOptions,
): Promise<void> {
    const queue = getBgRemovalQueue();
    const existing = await queue.getJob(data.imageId);
    if (existing && isFinishedQueueJobState(await existing.getState())) {
        await existing.remove();
    }
    // Deterministic jobId = ProcessedImage.id. A live job with this id is
    // left in place; a second add is ignored by BullMQ instead of running twice.
    await queue.add(`bg-${data.imageId}`, data, { ...opts, jobId: data.imageId });
}

export async function checkBgRemovalWorker(): Promise<void> {
    const queue = getBgRemovalQueue();
    const workerCount = await queue.getWorkersCount();
    if (workerCount <= 0) {
        throw new Error("No background worker is online");
    }
}

export { QUEUE_NAMES, MAX_IMAGES_PER_JOB } from "./connection";
