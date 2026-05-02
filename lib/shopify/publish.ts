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
import { shopifyGraphqlWithRetry } from "./retry";

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
        throw new Error(
            `Shopify productCreateMedia failed: ${json.errors.map((e) => e.message).join(", ")}`,
        );
    }
    const result = json.data?.productCreateMedia;
    if (!result) {
        throw new Error("Shopify productCreateMedia returned no data");
    }
    if (result.mediaUserErrors.length > 0) {
        throw new Error(
            `Shopify mediaUserErrors: ${result.mediaUserErrors
                .map((e) => `${e.code ?? ""} ${e.message}`)
                .join("; ")}`,
        );
    }
    const created = result.media[0];
    if (!created?.id) {
        throw new Error("Shopify productCreateMedia returned no media node");
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
