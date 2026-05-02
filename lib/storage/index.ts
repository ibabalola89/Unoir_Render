/**
 * S3-compatible CDN storage.
 *
 * Used for:
 *  - Original-image backups (Phase 5 rollback source-of-truth)
 *  - Processed-image artifacts served back to the merchant + Shopify
 *
 * Configure with any S3-compatible provider (Cloudflare R2, AWS S3, Backblaze B2, etc.).
 *
 * Required env:
 *   STORAGE_BUCKET, STORAGE_REGION, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY
 *   Aliases: STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY
 * Optional:
 *   STORAGE_ENDPOINT          (R2/B2/MinIO endpoint URL)
 *   STORAGE_ACCOUNT_ID        (Cloudflare R2 account id; derives endpoint)
 *   STORAGE_PUBLIC_BASE_URL   (public CDN base, e.g. https://cdn.unoir.app)
 *                             — falls back to a presigned GET URL if absent.
 */

import {
    DeleteObjectsCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _client: S3Client | null = null;

function getClient(): S3Client {
    if (_client) return _client;
    const region = process.env.STORAGE_REGION;
    const accessKeyId = process.env.STORAGE_ACCESS_KEY ?? process.env.STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_SECRET_KEY ?? process.env.STORAGE_SECRET_ACCESS_KEY;
    const endpoint = resolveStorageEndpoint();
    if (!region || !accessKeyId || !secretAccessKey) {
        throw new Error(
            "Storage env missing: STORAGE_REGION / STORAGE_ACCESS_KEY or STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_KEY or STORAGE_SECRET_ACCESS_KEY",
        );
    }
    _client = new S3Client({
        region,
        endpoint,
        forcePathStyle: Boolean(endpoint),
        credentials: { accessKeyId, secretAccessKey },
    });
    return _client;
}

function resolveStorageEndpoint(): string | undefined {
    const explicitEndpoint = process.env.STORAGE_ENDPOINT?.trim();
    if (explicitEndpoint) return explicitEndpoint;

    const accountId = process.env.STORAGE_ACCOUNT_ID?.trim();
    return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined;
}

function getBucket(): string {
    const bucket = process.env.STORAGE_BUCKET;
    if (!bucket) throw new Error("STORAGE_BUCKET is not set");
    return bucket;
}

export interface StoredObject {
    key: string;
    contentType: string;
    size: number;
}

/** TTL for short-lived presigned read URLs when no public CDN base is configured. */
const PRESIGN_TTL_SECONDS = 60 * 15; // 15 min — re-presigned on every read

/** Long-lived TTL for Shopify's async media ingest (publish path). */
const PUBLISH_PRESIGN_TTL_SECONDS = 60 * 60 * 24; // 24h — Shopify can retry slowly
const PUBLIC_PROBE_PREFIX = "health/public-cdn";
const PUBLIC_PROBE_FETCH_ATTEMPTS = 3;
const PUBLIC_PROBE_RETRY_DELAY_MS = 750;

/**
 * Validate `STORAGE_PUBLIC_BASE_URL` once at first use. A misconfigured
 * value (missing scheme, trailing whitespace, etc.) silently produces broken
 * Shopify ingest URLs and is one of the worst possible failure modes —
 * Shopify retries the bad URL for hours before giving up.
 */
let _publicBaseChecked = false;
function resolvePublicBase(): string | undefined {
    const base = process.env.STORAGE_PUBLIC_BASE_URL?.trim();
    if (!base) return undefined;
    if (!_publicBaseChecked) {
        try {
            const u = new URL(base);
            if (u.protocol !== "https:" && u.protocol !== "http:") {
                throw new Error(`unsupported protocol ${u.protocol}`);
            }
        } catch (err) {
            throw new Error(
                `STORAGE_PUBLIC_BASE_URL is not a valid URL (got: ${JSON.stringify(base)}): ${err instanceof Error ? err.message : String(err)
                }`,
            );
        }
        _publicBaseChecked = true;
    }
    return base.replace(/\/$/, "");
}

/**
 * Resolve a stored key to a publicly-accessible URL.
 * Prefers `STORAGE_PUBLIC_BASE_URL` (stable). Falls back to a short-lived presigned URL.
 * Always call this at *read time* — never persist the returned URL.
 */
export async function getPublicUrl(key: string): Promise<string> {
    const base = resolvePublicBase();
    if (base) return `${base}/${key}`;
    return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: getBucket(), Key: key }), {
        expiresIn: PRESIGN_TTL_SECONDS,
    });
}

/**
 * URL specifically for Shopify's `productCreateMedia` (publish path).
 *
 * Shopify ingests media **asynchronously**: the mutation returns immediately
 * with status=PROCESSING and Shopify's CDN fetches the URL on its own
 * schedule, with retries that can stretch hours. A 15-minute presign is
 * not enough.
 *
 * In production we **require** `STORAGE_PUBLIC_BASE_URL` to be set so the URL
 * is stable for as long as the object exists. In dev we fall back to a 24h
 * presign so the loop still works without R2/CDN configured.
 */
export async function getPublishUrl(key: string): Promise<string> {
    const base = resolvePublicBase();
    if (base) return `${base}/${key}`;
    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "STORAGE_PUBLIC_BASE_URL must be set in production. Shopify's async " +
            "media ingest can retry for hours; presigned URLs expire and break publish.",
        );
    }
    return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: getBucket(), Key: key }), {
        expiresIn: PUBLISH_PRESIGN_TTL_SECONDS,
    });
}

export async function uploadBuffer(input: {
    key: string;
    body: Buffer;
    contentType: string;
}): Promise<StoredObject> {
    await getClient().send(
        new PutObjectCommand({
            Bucket: getBucket(),
            Key: input.key,
            Body: input.body,
            ContentType: input.contentType,
        }),
    );
    return {
        key: input.key,
        contentType: input.contentType,
        size: input.body.byteLength,
    };
}

export async function deleteStoredObjects(keys: Array<string | null | undefined>): Promise<void> {
    const uniqueKeys = [...new Set(keys.filter((key): key is string => Boolean(key)))];
    if (uniqueKeys.length === 0) return;

    for (let i = 0; i < uniqueKeys.length; i += 1000) {
        const batch = uniqueKeys.slice(i, i + 1000);
        await getClient().send(
            new DeleteObjectsCommand({
                Bucket: getBucket(),
                Delete: {
                    Objects: batch.map((Key) => ({ Key })),
                    Quiet: true,
                },
            }),
        );
    }
}

/**
 * Liveness probe for the storage backend. Read-only — no writes — so
 * /health is safe to poll at high frequency without leaving orphaned
 * objects behind. Verifies credentials, endpoint, signing, and that the
 * bucket exists + is accessible.
 *
 * Uses ListObjectsV2 with MaxKeys=1 because Cloudflare R2 does not fully
 * implement HeadBucket — the response is missing fields the SDK expects
 * and surfaces as `UnknownError`.
 */
export async function checkStorageBucket(): Promise<void> {
    await getClient().send(
        new ListObjectsV2Command({ Bucket: getBucket(), MaxKeys: 1 }),
    );
}

/**
 * End-to-end public CDN probe for Shopify media ingest readiness.
 *
 * This intentionally writes and then fetches a tiny object because bucket
 * credentials alone don't prove `STORAGE_PUBLIC_BASE_URL` is publicly serving
 * object keys. Keep this out of normal high-frequency liveness checks; use it
 * from explicit smoke tests or internal ops checks.
 */
export async function checkPublicStorageAccess(): Promise<void> {
    const base = resolvePublicBase();
    if (!base) {
        throw new Error("STORAGE_PUBLIC_BASE_URL is not set");
    }

    const key = `${PUBLIC_PROBE_PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    const body = `unoir-public-cdn-ok:${key}`;
    await uploadBuffer({
        key,
        body: Buffer.from(body, "utf8"),
        contentType: "text/plain; charset=utf-8",
    });

    try {
        const url = `${base}/${key}`;
        const response = await fetchPublicProbe(url);
        if (!response.ok) {
            throw new Error(`public CDN returned ${response.status} ${response.statusText}`);
        }
        const text = await response.text();
        if (text !== body) {
            throw new Error("public CDN returned unexpected object body");
        }
    } finally {
        await deleteStoredObjects([key]).catch((err) => {
            console.error(
                `[storage] failed to delete public CDN probe ${key}:`,
                err instanceof Error ? err.message : String(err),
            );
        });
    }
}

async function fetchPublicProbe(url: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= PUBLIC_PROBE_FETCH_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(url, {
                cache: "no-store",
                signal: AbortSignal.timeout(10_000),
            });
            if (response.ok || attempt === PUBLIC_PROBE_FETCH_ATTEMPTS) return response;
        } catch (err) {
            lastError = err;
            if (attempt === PUBLIC_PROBE_FETCH_ATTEMPTS) break;
        }
        await new Promise((resolve) => setTimeout(resolve, PUBLIC_PROBE_RETRY_DELAY_MS));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Streams a remote URL → S3, returns the stored object metadata (key only). */
export async function uploadFromUrl(input: {
    key: string;
    sourceUrl: string;
    /** Hard timeout for the download in ms (default 30s). */
    timeoutMs?: number;
}): Promise<StoredObject> {
    const res = await fetch(input.sourceUrl, {
        signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
    });
    if (!res.ok) {
        throw new Error(
            `Failed to download source ${input.sourceUrl}: ${res.status} ${res.statusText}`,
        );
    }
    const arrayBuffer = await res.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    return uploadBuffer({ key: input.key, body, contentType });
}

export function buildOriginalKey(jobId: string, mediaId: string): string {
    return `originals/${jobId}/${encodeURIComponent(mediaId)}`;
}

export function buildProcessedKey(
    jobId: string,
    mediaId: string,
    ext: "jpg" | "png",
): string {
    return `processed/${jobId}/${encodeURIComponent(mediaId)}.${ext}`;
}
