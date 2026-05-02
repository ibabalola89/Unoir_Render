import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { shopifyGraphqlWithRetry } from "./retry";
import { MAX_IMAGES_PER_JOB } from "@lib/queue/constants";

/**
 * Phase 2 — Product Media Engine
 *
 * Fetches products with their media (images only) for the picker UI.
 * Supports pagination + free-text search via Shopify's products query syntax.
 *
 * Uses `media` (not deprecated `images`) so MediaImage GIDs flow straight
 * into Phase 5's productUpdateMedia / productCreateMedia mutations.
 *
 * Docs:
 *   https://shopify.dev/docs/api/admin-graphql/latest/queries/products
 *   https://shopify.dev/docs/api/admin-graphql/latest/objects/MediaImage
 */

export interface ProductImage {
    /** Shopify MediaImage GID — `gid://shopify/MediaImage/...` */
    id: string;
    url: string;
    altText: string | null;
    width: number | null;
    height: number | null;
    /** Original source URL (pre-CDN transforms), used for downloading bytes server-side. */
    originalSource: string | null;
}

export interface ProductSummary {
    id: string;
    title: string;
    handle: string;
    status: string;
    totalImages: number;
    images: ProductImage[];
}

export interface ProductsPage {
    products: ProductSummary[];
    pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor: string | null;
        endCursor: string | null;
    };
}

export interface FetchProductsInput {
    first?: number;
    last?: number;
    after?: string | null;
    before?: string | null;
    /** Free-text query passed to Shopify's products `query` arg. */
    query?: string | null;
}

const PRODUCTS_QUERY = `#graphql
  query UnoirProducts(
    $first: Int
    $last: Int
    $after: String
    $before: String
    $query: String
  ) {
    products(
      first: $first
      last: $last
      after: $after
      before: $before
      query: $query
      sortKey: UPDATED_AT
      reverse: true
    ) {
      edges {
        cursor
        node {
          id
          title
          handle
          status
          media(first: ${MAX_IMAGES_PER_JOB}, query: "media_type:IMAGE") {
            edges {
              node {
                ... on MediaImage {
                  id
                  image {
                    url
                    altText
                    width
                    height
                  }
                  originalSource {
                    url
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

export const DEFAULT_PAGE_SIZE = 25;

interface RawMediaImageNode {
    id?: string;
    image?: {
        url: string;
        altText: string | null;
        width: number | null;
        height: number | null;
    } | null;
    originalSource?: { url: string } | null;
}

interface RawProductsResponse {
    data?: {
        products: {
            edges: Array<{
                node: {
                    id: string;
                    title: string;
                    handle: string;
                    status: string;
                    media: { edges: Array<{ node: RawMediaImageNode }> };
                };
            }>;
            pageInfo: ProductsPage["pageInfo"];
        };
    };
    errors?: Array<{ message: string }>;
}

export async function fetchProducts(
    admin: AdminApiContext,
    input: FetchProductsInput = {},
): Promise<ProductsPage> {
    const usePrev = Boolean(input.before);
    const variables: Record<string, unknown> = {
        query: input.query ?? undefined,
    };
    if (usePrev) {
        variables.last = input.last ?? DEFAULT_PAGE_SIZE;
        variables.before = input.before;
    } else {
        variables.first = input.first ?? DEFAULT_PAGE_SIZE;
        if (input.after) variables.after = input.after;
    }

    const json = await shopifyGraphqlWithRetry<RawProductsResponse>(admin, async (a) => {
        const response = await a.graphql(PRODUCTS_QUERY, { variables });
        return (await response.json()) as RawProductsResponse;
    });

    if (json.errors?.length) {
        throw new Error(
            `Shopify products query failed: ${json.errors.map((e) => e.message).join(", ")}`,
        );
    }
    if (!json.data) {
        throw new Error("Shopify products query returned no data");
    }

    const products: ProductSummary[] = json.data.products.edges.map(({ node }) => {
        const images: ProductImage[] = node.media.edges
            .map((e) => e.node)
            .filter((m): m is RawMediaImageNode => Boolean(m.id && m.image?.url))
            .map((m) => ({
                id: m.id!,
                url: m.image!.url,
                altText: m.image!.altText ?? null,
                width: m.image!.width ?? null,
                height: m.image!.height ?? null,
                originalSource: m.originalSource?.url ?? null,
            }));

        return {
            id: node.id,
            title: node.title,
            handle: node.handle,
            status: node.status,
            totalImages: images.length,
            images,
        };
    });

    return {
        products,
        pageInfo: json.data.products.pageInfo,
    };
}

/** V1 hardcoded: only JPG + PNG are eligible for background removal. */
const ELIGIBLE_EXTENSION_RE = /\.(jpe?g|png)(?:$|\?|#)/i;

export function isEligibleImage(image: ProductImage): boolean {
    // Prefer originalSource (pre-CDN-transform) when available — Shopify's CDN
    // can rewrite to .webp variants in the displayed `url`.
    const candidate = image.originalSource ?? image.url;
    return isEligibleSourceUrl(candidate);
}

/** URL-only variant for server-side validation in the process action. */
export function isEligibleSourceUrl(candidate: string): boolean {
    try {
        const url = new URL(candidate);
        return ELIGIBLE_EXTENSION_RE.test(url.pathname);
    } catch {
        return ELIGIBLE_EXTENSION_RE.test(candidate);
    }
}

/**
 * Server-side resolver: given a list of MediaImage GIDs (from form input),
 * returns the canonical Shopify-CDN source URL for each. Used by the process
 * action to avoid trusting URLs from the client (SSRF guard).
 *
 * The Admin GraphQL API is shop-scoped, so any media not owned by the current
 * shop will simply be missing from the result.
 */
const MEDIA_NODES_QUERY = `#graphql
  query UnoirMediaSources($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on MediaImage {
        id
        image { url altText }
        originalSource { url }
      }
    }
  }
`;

interface RawMediaNodesResponse {
    data?: {
        nodes: Array<RawMediaImageNode | null>;
    };
    errors?: Array<{ message: string }>;
}

export interface MediaSourceMetadata {
    sourceUrl: string;
    altText: string | null;
}

export async function fetchMediaSourceMetadata(
    admin: AdminApiContext,
    mediaIds: string[],
): Promise<Map<string, MediaSourceMetadata>> {
    if (mediaIds.length === 0) return new Map();
    const json = await shopifyGraphqlWithRetry<RawMediaNodesResponse>(admin, async (a) => {
        const response = await a.graphql(MEDIA_NODES_QUERY, {
            variables: { ids: mediaIds },
        });
        return (await response.json()) as RawMediaNodesResponse;
    });
    if (json.errors?.length) {
        throw new Error(
            `Shopify nodes query failed: ${json.errors.map((e) => e.message).join(", ")}`,
        );
    }
    const map = new Map<string, MediaSourceMetadata>();
    for (const node of json.data?.nodes ?? []) {
        if (!node?.id) continue;
        const chosen = chooseEligibleShopifyImageSource(
            node.image?.url,
            node.originalSource?.url,
        );
        if (chosen) map.set(node.id, {
            sourceUrl: chosen,
            altText: node.image?.altText ?? null,
        });
    }
    return map;
}

export async function fetchMediaSources(
    admin: AdminApiContext,
    mediaIds: string[],
): Promise<Map<string, string>> {
    const metadata = await fetchMediaSourceMetadata(admin, mediaIds);
    return new Map([...metadata].map(([id, value]) => [id, value.sourceUrl]));
}

const PRODUCT_MEDIA_OWNERSHIP_QUERY = `#graphql
  query UnoirProductMediaOwnership($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        media(first: ${MAX_IMAGES_PER_JOB}, query: "media_type:IMAGE") {
          edges {
            node {
              ... on MediaImage {
                id
              }
            }
          }
        }
      }
    }
  }
`;

interface RawProductMediaOwnershipResponse {
    data?: {
        nodes: Array<{
            id?: string;
            media?: { edges: Array<{ node: { id?: string } }> };
        } | null>;
    };
    errors?: Array<{ message: string }>;
}

export async function fetchProductMediaOwnership(
    admin: AdminApiContext,
    productIds: string[],
): Promise<Map<string, Set<string>>> {
    if (productIds.length === 0) return new Map();
    const uniqueIds = [...new Set(productIds)];
    const json = await shopifyGraphqlWithRetry<RawProductMediaOwnershipResponse>(
        admin,
        async (a) => {
            const response = await a.graphql(PRODUCT_MEDIA_OWNERSHIP_QUERY, {
                variables: { ids: uniqueIds },
            });
            return (await response.json()) as RawProductMediaOwnershipResponse;
        },
    );
    if (json.errors?.length) {
        throw new Error(
            `Shopify product media ownership query failed: ${json.errors.map((e) => e.message).join(", ")}`,
        );
    }

    const map = new Map<string, Set<string>>();
    for (const node of json.data?.nodes ?? []) {
        if (!node?.id || !node.media) continue;
        map.set(
            node.id,
            new Set(
                node.media.edges
                    .map((edge) => edge.node.id)
                    .filter((id): id is string => Boolean(id)),
            ),
        );
    }
    return map;
}

export function chooseEligibleShopifyImageSource(
    cdnUrl?: string | null,
    originalUrl?: string | null,
): string | undefined {
    // SECURITY: `originalSource.url` can be the merchant's own server (the URL
    // they passed at media-create time). Only use Shopify-controlled hosts.
    // Prefer eligible `originalSource` so server-side processing matches the
    // picker eligibility check when Shopify rewrites the display URL to WebP.
    for (const candidate of [originalUrl, cdnUrl]) {
        if (
            candidate &&
            isShopifyHostedUrl(candidate) &&
            isEligibleSourceUrl(candidate)
        ) {
            return candidate;
        }
    }
    return undefined;
}

function isShopifyHostedUrl(value: string): boolean {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") return false;
        return /(?:^|\.)shopify\.com$|(?:^|\.)shopifycdn\.com$|(?:^|\.)myshopify\.com$/i.test(
            url.hostname,
        );
    } catch {
        return false;
    }
}
