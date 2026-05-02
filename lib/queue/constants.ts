/**
 * Pure constants shared by producer, worker, and UI.
 * MUST NOT import bullmq, ioredis, or any Node-only module — this file is
 * imported by browser-bundled Remix routes (e.g. app.picker.tsx).
 */

export const MAX_IMAGES_PER_JOB = 50;

export const QUEUE_NAMES = {
    bgRemoval: "bg-removal",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
