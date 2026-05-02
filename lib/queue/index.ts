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

export async function enqueueBgRemoval(
    data: BgRemovalJobData,
    opts?: JobsOptions,
): Promise<void> {
    const queue = getBgRemovalQueue();
    // Deterministic jobId = ProcessedImage.id. BullMQ rejects duplicate
    // jobIds, so a double-submit (e.g. retry button mashed) cannot enqueue
    // the same image twice and burn extra remove.bg credits.
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
