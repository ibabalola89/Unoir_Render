/**
 * BullMQ + ioredis configuration shared by the producer (Remix) and worker.
 *
 * V1 hardcoded constraints:
 *   - One queue: `bg-removal`
 *   - Max 50 images per job (enforced at enqueue time)
 *
 * Required env:
 *   REDIS_URL  (e.g. redis://localhost:6379  or  rediss://default:pwd@host:6379)
 */

import IORedis, { type Redis } from "ioredis";

export { MAX_IMAGES_PER_JOB, QUEUE_NAMES, type QueueName } from "./constants";

let _connection: Redis | null = null;

export function validateRedisUrl(url = process.env.REDIS_URL): string {
    if (!url) {
        throw new Error("REDIS_URL is not set");
    }
    if (process.env.NODE_ENV === "production" && !url.startsWith("rediss://")) {
        throw new Error("Production REDIS_URL must use rediss:// with TLS");
    }
    return url;
}

/**
 * Lazy singleton Redis connection.
 * BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`.
 */
export function getRedisConnection(): Redis {
    if (_connection) return _connection;
    const url = validateRedisUrl();
    _connection = new IORedis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: false,
    });
    _connection.on("error", (err) => {
        console.error("[redis] connection error:", err.message);
    });
    return _connection;
}
