/**
 * Shopify publish + rollback helpers.
 *
 * V1 approach is **additive**:
 *  - Publish = call `productCreateMedia` to attach the processed image as a
 *    NEW media on the product. The original media is left intact.
 *  - Rollback = call `productDeleteMedia` to remove the media we previously
 *    published. The original is still there, untouched.
 *
 * This is the safest possible "publish" — nothing the merchant had before is
 * destroyed. They can swap to the new image manually from the Shopify admin
 * once they're happy, or roll back with one click.
 *
 * Docs:
 *   https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreateMedia
 *   https://shopify.dev/docs/api/admin-graphql/latest/mutations/productDeleteMedia
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { ShopifyGraphqlThrottledError, shopifyGraphqlWithRetry } from "./retry";

/** Shopify keeps MediaImage.alt after it replaces originalSource with its CDN URL. */
export const SHOPIFY_IMAGE_ALT_MAX = 512;
export const PUBLISH_STAMP_PREFIX = "unoir-publish:";

export function publishStampForImage(imageId: string): string {
    return `${PUBLISH_STAMP_PREFIX}${imageId}`;
}

export function altHasPublishStamp(alt: string | null | undefined, stamp: string): boolean {
    if (!alt || !stamp) return false;
    return alt.split(/\s+/).includes(stamp);
}

/**
 * Keep the merchant alt and append the stamp as its own token.
 * A very long alt is shortened so the stamp still fits Shopify's limit.
 */
export function altTextWithPublishStamp(
    merchantAlt: string | null | undefined,
    stamp: string,
): string {
    const preserved = (merchantAlt ?? "")
        .split(/\s+/)
        .filter((token) => token && token !== stamp)
        .join(" ");
    if (!preserved) return stamp.slice(0, SHOPIFY_IMAGE_ALT_MAX);
    const combined = `${preserved} ${stamp}`;
    if (combined.length <= SHOPIFY_IMAGE_ALT_MAX) return combined;
    const room = SHOPIFY_IMAGE_ALT_MAX - stamp.length - 1;
    if (room <= 0) return stamp.slice(0, SHOPIFY_IMAGE_ALT_MAX);
    return `${preserved.slice(0, room).trimEnd()} ${stamp}`;
}

/** Shopify answered and did not create media. A later publish may try once more. */
export class ShopifyPublishRejectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ShopifyPublishRejectedError";
    }
}

/**
 * True when a create call may already have added a file.
 * A rejection or throttle means Shopify did not accept the mutation.
 */
export function publishAttemptMayHaveCreated(err: unknown): boolean {
    if (err instanceof ShopifyPublishRejectedError) return false;
    if (err instanceof ShopifyGraphqlThrottledError) return false;
    return true;
}

const PRODUCT_CREATE_MEDIA = `#graphql
  mutation UnoirCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          status
        }
      }
      mediaUserErrors {
        field
        message
        code
      }
    }
  }
`;

interface CreateMediaResponse {
    data?: {
        productCreateMedia: {
            media: Array<{ id?: string; status?: string }>;
            mediaUserErrors: Array<{ field?: string[]; message: string; code?: string }>;
        };
    };
    errors?: Array<{ message: string }>;
}

export interface PublishMediaInput {
    productId: string;
    sourceUrl: string;
    altText?: string | null;
}

export interface PublishMediaResult {
    mediaId: string;
    status: string | null;
}

export async function publishProcessedMedia(
    admin: AdminApiContext,
    input: PublishMediaInput,
): Promise<PublishMediaResult> {
    const json = await shopifyGraphqlWithRetry<CreateMediaResponse>(admin, async (a) => {
        const response = await a.graphql(PRODUCT_CREATE_MEDIA, {
            variables: {
                productId: input.productId,
                media: [
                    {
                        originalSource: input.sourceUrl,
                        alt: input.altText ?? undefined,
                        mediaContentType: "IMAGE",
                    },
                ],
            },
        });
        return (await response.json()) as CreateMediaResponse;
    });

    if (json.errors?.length) {
        throw new ShopifyPublishRejectedError(
            `Shopify productCreateMedia failed: ${json.errors.map((e) => e.message).join(", ")}`,
        );
    }
    const result = json.data?.productCreateMedia;
    if (!result) {
        throw new ShopifyPublishRejectedError("Shopify productCreateMedia returned no data");
    }
    if (result.mediaUserErrors.length > 0) {
        throw new ShopifyPublishRejectedError(
            `Shopify mediaUserErrors: ${result.mediaUserErrors
                .map((e) => `${e.code ?? ""} ${e.message}`)
                .join("; ")}`,
        );
    }
    const created = result.media[0];
    if (!created?.id) {
        throw new ShopifyPublishRejectedError("Shopify productCreateMedia returned no media node");
    }
    return { mediaId: created.id, status: created.status ?? null };
}

const PRODUCT_DELETE_MEDIA = `#graphql
  mutation UnoirDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors {
        field
        message
        code
      }
    }
  }
`;

interface DeleteMediaResponse {
    data?: {
        productDeleteMedia: {
            deletedMediaIds: string[] | null;
            mediaUserErrors: Array<{ field?: string[]; message: string; code?: string }>;
        };
    };
    errors?: Array<{ message: string }>;
}

// Shopify error codes that mean "the media is already gone" — for rollback
// purposes that's success, not failure.
const ALREADY_GONE_CODES = new Set([
    "MEDIA_DOES_NOT_EXIST",
    "MEDIA_CANNOT_BE_MODIFIED",
    "NOT_FOUND",
]);

export async function deletePublishedMedia(
    admin: AdminApiContext,
    input: { productId: string; mediaId: string },
): Promise<void> {
    const json = await shopifyGraphqlWithRetry<DeleteMediaResponse>(admin, async (a) => {
        const response = await a.graphql(PRODUCT_DELETE_MEDIA, {
            variables: { productId: input.productId, mediaIds: [input.mediaId] },
        });
        return (await response.json()) as DeleteMediaResponse;
    });
    if (json.errors?.length) {
        throw new Error(
            `Shopify productDeleteMedia failed: ${json.errors.map((e) => e.message).join(", ")}`,
        );
    }
    const result = json.data?.productDeleteMedia;
    if (result?.mediaUserErrors.length) {
        // Treat "already gone" as success — the merchant may have deleted the
        // media manually in the Shopify admin.
        const fatal = result.mediaUserErrors.filter(
            (e) => !(e.code && ALREADY_GONE_CODES.has(e.code)),
        );
        if (fatal.length > 0) {
            throw new Error(
                `Shopify mediaUserErrors: ${fatal
                    .map((e) => `${e.code ?? ""} ${e.message}`)
                    .join("; ")}`,
            );
        }
    }
}

/**
 * Verify the async ingest status of media we previously created. Shopify's
 * `productCreateMedia` returns immediately with status `PROCESSING`; the bytes
 * are fetched + indexed asynchronously and the status flips to `READY` or
 * `FAILED`. We must not mark our DB rows `published` until we've seen `READY`.
 */
const MEDIA_STATUS_QUERY = `#graphql
  query UnoirMediaStatus($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on MediaImage {
        id
        status
      }
    }
  }
`;

interface MediaStatusResponse {
    data?: {
        nodes: Array<{ id?: string; status?: string } | null>;
    };
    errors?: Array<{ message: string }>;
}

export type MediaIngestStatus = "READY" | "FAILED" | "PROCESSING" | "UNKNOWN";

export async function verifyMediaStatus(
    admin: AdminApiContext,
    mediaIds: string[],
): Promise<Map<string, MediaIngestStatus>> {
    const out = new Map<string, MediaIngestStatus>();
    if (mediaIds.length === 0) return out;
    const json = await shopifyGraphqlWithRetry<MediaStatusResponse>(admin, async (a) => {
        const response = await a.graphql(MEDIA_STATUS_QUERY, {
            variables: { ids: mediaIds },
        });
        return (await response.json()) as MediaStatusResponse;
    });
    if (json.errors?.length) {
        throw new Error(
            `Shopify nodes(media) failed: ${json.errors.map((e) => e.message).join(", ")}`,
        );
    }
    for (const node of json.data?.nodes ?? []) {
        if (!node?.id) continue;
        const s = (node.status ?? "").toUpperCase();
        out.set(
            node.id,
            s === "READY" || s === "FAILED" || s === "PROCESSING"
                ? (s as MediaIngestStatus)
                : "UNKNOWN",
        );
    }
    return out;
}

/**
 * Move a freshly-published media item to position 0 (primary / featured) on
 * the product so the PDP shows the new background-removed image immediately,
 * without the merchant having to drag-reorder in Shopify admin.
 *
 * The original media is NOT deleted — it stays in the gallery so rollback can
 * simply remove our addition and the previous primary returns to position 0
 * automatically.
 */
const PRODUCT_REORDER_MEDIA = `#graphql
  mutation UnoirReorderMedia($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      job { id }
      mediaUserErrors {
        field
        message
        code
      }
    }
  }
`;

interface ReorderMediaResponse {
    data?: {
        productReorderMedia: {
            job: { id: string } | null;
            mediaUserErrors: Array<{ field?: string[]; message: string; code?: string }>;
        };
    };
    errors?: Array<{ message: string }>;
}

export type AppAddedMediaMatch =
    | { kind: "found"; mediaId: string }
    | { kind: "none" }
    | { kind: "ambiguous" };

type GalleryMedia = {
    id?: string | null;
    sourceUrl?: string | null;
    alt?: string | null;
};

/**
 * Match a file this app added. A processed-key source URL still counts.
 * After Shopify replaces that URL, the publish stamp in alt text is the match.
 * Alt text, gallery position, and the original product media id are not used
 * except for that exact stamp token.
 */
export function matchAppAddedMedia(
    items: GalleryMedia[],
    input: { processedKey?: string | null; publishStamp?: string | null },
): AppAddedMediaMatch {
    const processedKey = input.processedKey || null;
    const publishStamp = input.publishStamp || null;
    const matches = items.filter((item): item is GalleryMedia & { id: string } => {
        if (!item.id) return false;
        const byKey = Boolean(processedKey && item.sourceUrl?.includes(processedKey));
        const byStamp = Boolean(publishStamp && altHasPublishStamp(item.alt, publishStamp));
        return byKey || byStamp;
    });
    if (matches.length === 1) return { kind: "found", mediaId: matches[0].id };
    if (matches.length > 1) return { kind: "ambiguous" };
    return { kind: "none" };
}

/** Match Shopify media we already created for this processed object key. */
export function matchMediaByProcessedKey(
    items: GalleryMedia[],
    processedKey: string,
): AppAddedMediaMatch {
    return matchAppAddedMedia(items, { processedKey });
}

const PRODUCT_MEDIA_SOURCES = `#graphql
  query UnoirProductMediaSources($id: ID!, $after: String) {
    product(id: $id) {
      media(first: 50, after: $after, query: "media_type:IMAGE") {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            ... on MediaImage {
              id
              alt
              originalSource { url }
            }
          }
        }
      }
    }
  }
`;

interface ProductMediaSourcesResponse {
    data?: {
        product?: {
            media?: {
                pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
                edges: Array<{ node: { id?: string; alt?: string | null; originalSource?: { url?: string | null } | null } }>;
            };
        } | null;
    };
    errors?: Array<{ message: string }>;
}

const MAX_PRODUCT_MEDIA_PAGES = 10;

export type ExistingAppMediaLookup =
    | AppAddedMediaMatch
    | { kind: "incomplete" };

/**
 * Look for a Shopify image this app already added. A single match is returned
 * only after the gallery is fully read. More than one match, or a gallery
 * larger than the pages we read, does not pick a file.
 */
export async function findExistingAppMedia(
    admin: AdminApiContext,
    input: { productId: string; processedKey?: string | null; publishStamp?: string | null },
): Promise<ExistingAppMediaLookup> {
    const collected: GalleryMedia[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PRODUCT_MEDIA_PAGES; page++) {
        const cursor: string | null = after;
        const json: ProductMediaSourcesResponse = await shopifyGraphqlWithRetry<ProductMediaSourcesResponse>(admin, async (a) => {
            const response: { json(): Promise<ProductMediaSourcesResponse> } = await a.graphql(PRODUCT_MEDIA_SOURCES, {
                variables: { id: input.productId, after: cursor },
            });
            return response.json();
        });
        if (json.errors?.length) {
            throw new Error(
                `Shopify product media lookup failed: ${json.errors.map((e) => e.message).join(", ")}`,
            );
        }
        const media = json.data?.product?.media;
        for (const edge of media?.edges ?? []) {
            collected.push({
                id: edge.node.id,
                alt: edge.node.alt,
                sourceUrl: edge.node.originalSource?.url,
            });
        }
        const matched = matchAppAddedMedia(collected, input);
        if (matched.kind === "ambiguous") return matched;
        if (!media?.pageInfo?.hasNextPage || !media.pageInfo.endCursor) return matched;
        after = media.pageInfo.endCursor;
    }
    return { kind: "incomplete" };
}

export async function promoteMediaToPrimary(
    admin: AdminApiContext,
    input: { productId: string; mediaId: string },
): Promise<void> {
    const json = await shopifyGraphqlWithRetry<ReorderMediaResponse>(admin, async (a) => {
        const response = await a.graphql(PRODUCT_REORDER_MEDIA, {
            variables: {
                id: input.productId,
                moves: [{ id: input.mediaId, newPosition: "0" }],
            },
        });
        return (await response.json()) as ReorderMediaResponse;
    });
    if (json.errors?.length) {
        throw new Error(
            `Shopify productReorderMedia failed: ${json.errors.map((e) => e.message).join(", ")}`,
        );
    }
    const result = json.data?.productReorderMedia;
    if (result?.mediaUserErrors.length) {
        throw new Error(
            `Shopify mediaUserErrors (reorder): ${result.mediaUserErrors
                .map((e) => `${e.code ?? ""} ${e.message}`)
                .join("; ")}`,
        );
    }
}
