import { json, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { checkRemoveBgAccount } from "@lib/ai/removeBg";
import { checkBgRemovalWorker } from "@lib/queue";
import { getRedisConnection } from "@lib/queue/connection";
import { checkPublicStorageAccess, checkStorageBucket } from "@lib/storage";
import { emitTelemetryEvent } from "@lib/telemetry";

interface CheckResult {
    ok: boolean;
    error?: string;
}

const HEALTH_TIMEOUT_MS = 2500;
const CDN_HEALTH_TIMEOUT_MS = 15_000;
const WORKER_OFFLINE_TELEMETRY_INTERVAL_MS = 5 * 60 * 1000;
let lastWorkerOfflineTelemetryAt = 0;

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const shallow = url.searchParams.get("shallow") === "1";
    const includeCdn = url.searchParams.get("cdn") === "1";

    // Run dependency checks in parallel — they're independent and one slow
    // backend should not stretch overall health latency.
    const [db, redis, storage, storageCdn, removeBg, worker] = await Promise.all([
        check("db", () => prisma.$queryRaw`SELECT 1`),
        shallow ? Promise.resolve({ ok: true } as CheckResult) : check("redis", () => getRedisConnection().ping()),
        shallow ? Promise.resolve({ ok: true } as CheckResult) : check("storage", () => checkStorageBucket()),
        shallow || !includeCdn
            ? Promise.resolve({ ok: true } as CheckResult)
            : check("storageCdn", () => checkPublicStorageAccess(), CDN_HEALTH_TIMEOUT_MS),
        shallow ? Promise.resolve({ ok: true } as CheckResult) : check("removeBg", () => checkRemoveBgAccount()),
        shallow ? Promise.resolve({ ok: true } as CheckResult) : check("worker", () => checkBgRemovalWorker()),
    ]);
    const checks = {
        app: { ok: true },
        db,
        redis,
        storage,
        storageCdn,
        removeBg,
        worker,
    } satisfies Record<string, CheckResult>;

    const ok = Object.values(checks).every((result) => result.ok);
    const now = Date.now();
    if (
        !shallow &&
        !worker.ok &&
        now - lastWorkerOfflineTelemetryAt >= WORKER_OFFLINE_TELEMETRY_INTERVAL_MS
    ) {
        lastWorkerOfflineTelemetryAt = now;
        emitTelemetryEvent("worker_offline", { error: worker.error ?? null }, "error");
    }
    return json({ ok, checks }, { status: ok ? 200 : 503 });
};

async function check(name: string, fn: () => Promise<unknown>, timeoutMs = HEALTH_TIMEOUT_MS): Promise<CheckResult> {
    try {
        await withTimeout(fn(), timeoutMs, `${name} check timed out`);
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            error: `${name}: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}
