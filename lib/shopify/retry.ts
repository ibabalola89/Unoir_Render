/**
 * Shopify GraphQL retry wrapper.
 *
 * Shopify's Admin GraphQL applies a per-shop **calculated query cost** rate
 * limit. When you exceed the bucket, the response shape is:
 *
 *   { data: null, errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }
 *
 * with a top-level `extensions.cost.throttleStatus` that tells you exactly
 * how long to wait. We honor that signal where present, otherwise fall back
 * to capped exponential backoff with jitter.
 *
 * 5xx and network errors are also retried. Per-image business errors
 * (mediaUserErrors) are NOT retried — those are caller business logic.
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

interface ThrottleStatus {
    maximumAvailable?: number;
    currentlyAvailable?: number;
    restoreRate?: number;
}

interface GraphqlResponseShape {
    data?: unknown;
    errors?: Array<{ message?: string; extensions?: { code?: string } }>;
    extensions?: { cost?: { throttleStatus?: ThrottleStatus } };
}

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;

function isThrottled(json: GraphqlResponseShape): boolean {
    // Only retry when *every* error is a throttle. A mixed payload (e.g.
    // THROTTLED + ACCESS_DENIED) is non-recoverable — surface it immediately
    // instead of burning attempts on a doomed query.
    const errs = json.errors;
    if (!errs?.length) return false;
    return errs.every((e) => e.extensions?.code === "THROTTLED");
}

function backoffDelay(attempt: number, throttleStatus?: ThrottleStatus): number {
    // Prefer the server's hint if we can compute it.
    if (throttleStatus?.restoreRate && throttleStatus?.maximumAvailable) {
        const deficit = Math.max(
            0,
            throttleStatus.maximumAvailable -
            (throttleStatus.currentlyAvailable ?? 0),
        );
        const seconds = deficit / throttleStatus.restoreRate;
        // Clamp to [200ms, 5s] so we never sleep longer than the request.
        return Math.min(5000, Math.max(200, Math.round(seconds * 1000)));
    }
    // Capped exponential backoff with jitter.
    const cap = 5000;
    const exp = Math.min(cap, BASE_DELAY_MS * 2 ** attempt);
    return exp / 2 + Math.random() * (exp / 2);
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run an Admin GraphQL request with throttle-aware retries.
 *
 * The handler is invoked on each attempt with the current admin context and
 * is responsible for issuing `admin.graphql(...)` and parsing the JSON. It
 * must return the full response JSON so we can inspect `errors`/`extensions`.
 */
export async function shopifyGraphqlWithRetry<T extends GraphqlResponseShape>(
    admin: AdminApiContext,
    runOnce: (admin: AdminApiContext) => Promise<T>,
): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            const json = await runOnce(admin);
            if (!isThrottled(json)) {
                return json;
            }
            const delay = backoffDelay(
                attempt,
                json.extensions?.cost?.throttleStatus,
            );
            await sleep(delay);
            continue;
        } catch (err) {
            lastErr = err;
            // Network / 5xx surface as thrown — retry with backoff.
            await sleep(backoffDelay(attempt));
            continue;
        }
    }
    if (lastErr) throw lastErr;
    throw new Error(
        `Shopify GraphQL throttled after ${MAX_ATTEMPTS} attempts`,
    );
}
