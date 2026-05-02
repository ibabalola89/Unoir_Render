import type { LoaderFunctionArgs } from "@remix-run/node";
import { randomUUID } from "node:crypto";
import { Form, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { useMemo, useState } from "react";
import {
    Page,
    Layout,
    Card,
    Text,
    BlockStack,
    InlineStack,
    Checkbox,
    Pagination,
    EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { AppNotice } from "../components/AppNotice";
import { authenticate } from "../shopify.server";
import {
    fetchProducts,
    isEligibleImage,
    DEFAULT_PAGE_SIZE,
    type ProductImage,
    type ProductSummary,
} from "@lib/shopify/products";
import { MAX_IMAGES_PER_JOB } from "@lib/queue/constants";
import { getPremiumExportCapacity } from "@lib/billing/capacity";
import { tryGetUsageSummary } from "@lib/billing/usage";
import { FREE_PLAN } from "@lib/billing/plans";
import {
    BACKGROUND_OPTIONS,
    DEFAULT_BACKGROUND_ID,
    getBackgroundAccessTier,
    isBackgroundAvailableForPlan,
    type BackgroundId,
} from "@lib/backgrounds";
import { getPickerErrorNotice } from "@lib/ui/failureCopy";
import styles from "../styles/studio.module.css";

interface SelectedImage {
    productId: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session, billing } = await authenticate.admin(request);
    const url = new URL(request.url);
    const query = url.searchParams.get("q");
    const after = url.searchParams.get("after");
    const before = url.searchParams.get("before");

    const [page, billingResult] = await Promise.all([
        fetchProducts(admin, {
            first: before ? undefined : DEFAULT_PAGE_SIZE,
            last: before ? DEFAULT_PAGE_SIZE : undefined,
            after,
            before,
            query,
        }),
        tryGetUsageSummary(session.shop, billing),
    ]);

    return { page, query: query ?? "", billingResult, processIdempotencyKey: randomUUID() };
};

export default function PickerRoute() {
    const { page, query, billingResult, processIdempotencyKey } = useLoaderData<typeof loader>();
    const [searchParams] = useSearchParams();
    const errorParam = searchParams.get("error");
    const navigation = useNavigation();
    const isLoading = navigation.state === "loading";
    const isSubmitting = navigation.state === "submitting";

    // Per-job cap is the lower of MAX_IMAGES_PER_JOB and the merchant's
    // remaining monthly quota. Once a merchant runs out, selection is locked
    // to zero and they're nudged to the billing page. If the Billing API is
    // unavailable we fail closed: cap is 0 and we render a banner.
    const usage = billingResult.ok ? billingResult.summary : null;
    const plan = usage?.plan ?? FREE_PLAN;
    const capacity = usage ? getPremiumExportCapacity(usage) : null;
    const selectionCap = usage
        ? Math.max(0, Math.min(MAX_IMAGES_PER_JOB, usage.remaining))
        : 0;

    const [selected, setSelected] = useState<Map<string, SelectedImage>>(
        () => new Map(),
    );
    const [background, setBackground] = useState<BackgroundId>(DEFAULT_BACKGROUND_ID);
    const [searchTerm, setSearchTerm] = useState(query);

    const eligibleImagesOnPage = useMemo(() => {
        return page.products.flatMap((product) =>
            product.images
                .filter(isEligibleImage)
                .map((image) => ({ image, productId: product.id })),
        );
    }, [page.products]);
    const eligibleCount = eligibleImagesOnPage.length;
    const unselectedEligibleCount = eligibleImagesOnPage.filter(
        ({ image }) => !selected.has(image.id),
    ).length;

    const toggle = (image: ProductImage, productId: string) => {
        setSelected((prev) => {
            const next = new Map(prev);
            if (next.has(image.id)) {
                next.delete(image.id);
            } else {
                if (next.size >= selectionCap) return prev;
                next.set(image.id, { productId });
            }
            return next;
        });
    };

    const toggleProduct = (product: ProductSummary) => {
        const eligible = product.images.filter(isEligibleImage);
        setSelected((prev) => {
            const next = new Map(prev);
            const allSelected = eligible.every((i) => next.has(i.id));
            if (allSelected) {
                eligible.forEach((i) => next.delete(i.id));
            } else {
                for (const i of eligible) {
                    if (next.size >= selectionCap) break;
                    next.set(i.id, { productId: product.id });
                }
            }
            return next;
        });
    };

    const selectAllEligibleOnPage = () => {
        setSelected((prev) => {
            const next = new Map(prev);
            for (const { image, productId } of eligibleImagesOnPage) {
                if (next.size >= selectionCap) break;
                if (!next.has(image.id)) {
                    next.set(image.id, { productId });
                }
            }
            return next;
        });
    };

    const clearSelection = () => setSelected(new Map());

    const atCap = selected.size >= selectionCap;
    const canSelectAllEligible =
        selectionCap > 0 && selected.size < selectionCap && unselectedEligibleCount > 0;
    // Only flag quota-exhausted when we actually know the quota. When the
    // billing check is down `billingDown` renders its own banner and we
    // don't double up with a misleading "no images remaining" warning.
    const quotaExhausted = capacity?.state === "exhausted";
    const billingDown = !usage;
    const showQuotaContext = !!usage && capacity !== null && capacity.state !== "available";
    const quotaNotice = usage && capacity ? getQuotaNotice({
        plan: usage.plan,
        quota: usage.quota,
        remaining: usage.remaining,
        state: capacity.state,
    }) : null;
    const submitText = `Standardize ${selected.size > 0 ? `(${selected.size})` : ""}`;
    const commandMetaText = `Eligible on page: ${eligibleCount}${showQuotaContext && !quotaExhausted ? ` · ${usage.remaining} images left this month` : ""}`;
    const pickerErrorNotice = getPickerErrorNotice(errorParam, {
        maxImagesPerJob: MAX_IMAGES_PER_JOB,
    });

    const buildPageHref = (cursor: string | null, dir: "after" | "before") => {
        if (!cursor) return undefined;
        const params = new URLSearchParams(searchParams);
        params.delete("after");
        params.delete("before");
        params.set(dir, cursor);
        return `?${params.toString()}`;
    };

    return (
        <Page>
            <TitleBar title="Select images" />
            <BlockStack gap="500">
                {billingDown && (
                    <AppNotice tone="warning" title="Billing check unavailable">
                        <p>
                            We couldn&apos;t verify your plan with Shopify. Selection
                            is paused until we can confirm your quota.
                        </p>
                    </AppNotice>
                )}
                {pickerErrorNotice && (
                    <AppNotice tone={pickerErrorNotice.tone} title={pickerErrorNotice.title}>
                        <p>{pickerErrorNotice.copy}</p>
                    </AppNotice>
                )}
                {errorParam === "finish-plan" && (
                    <AppNotice
                        action={{ label: "View plans", to: "/app/billing" }}
                        tone="warning"
                        title="Starter finish required"
                    >
                        <p>Start the 7-day trial to unlock Porcelain, Stone, Atelier, and Noir.</p>
                    </AppNotice>
                )}
                {errorParam === "rate-limit" && (
                    <AppNotice tone="warning" title="Job limit reached">
                        <p>
                            This shop has started several jobs recently. Try again in a little while.
                        </p>
                    </AppNotice>
                )}
                {errorParam === "quota" && usage && (
                    <AppNotice
                        action={{ label: "Plan & usage", to: "/app/billing" }}
                        label="Capacity status"
                        tone="warning"
                        title="Image capacity reached"
                    >
                        <p>{getQuotaExceededCopy(usage.plan, usage.quota)}</p>
                    </AppNotice>
                )}
                {quotaNotice && errorParam !== "quota" && (
                    <AppNotice
                        action={{ label: "Plan & usage", to: "/app/billing" }}
                        label="Capacity status"
                        tone="warning"
                        title={quotaNotice.title}
                    >
                        <p>{quotaNotice.copy}</p>
                    </AppNotice>
                )}
                {atCap && !quotaExhausted && usage && (
                    <AppNotice tone="warning" title="Job selection limit reached">
                        <p>
                            {`This job is at its ${selectionCap} image selection capacity (per-job max ${MAX_IMAGES_PER_JOB}, ${usage.remaining} remaining this month).`}
                        </p>
                    </AppNotice>
                )}

                <Card>
                    <BlockStack gap="300">
                        <Form className={styles.searchForm} method="get">
                            <label className={styles.srOnly} htmlFor="product-search">
                                Search products
                            </label>
                            <input
                                id="product-search"
                                className={styles.searchInput}
                                type="search"
                                name="q"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.currentTarget.value)}
                                placeholder="Search by title, vendor, tag..."
                                autoComplete="off"
                            />
                            <button className={styles.searchButton} type="submit">
                                {isLoading ? "Searching..." : "Search"}
                            </button>
                        </Form>

                        <BlockStack gap="200">
                            <span className={styles.backgroundKicker}>Curated finish</span>
                            <div className={styles.backgroundGrid}>
                                {BACKGROUND_OPTIONS.map((option) => {
                                    const selectedBackground = background === option.id;
                                    const requiresStarter = getBackgroundAccessTier(option.id) === "starter";
                                    const available = isBackgroundAvailableForPlan(option.id, plan);
                                    return (
                                        <button
                                            key={option.id}
                                            type="button"
                                            className={`${styles.backgroundOption} ${option.id === "noir" ? styles.backgroundOptionNoir : ""} ${selectedBackground ? styles.backgroundOptionSelected : ""} ${!available ? styles.backgroundOptionLocked : ""}`}
                                            aria-pressed={selectedBackground}
                                            aria-label={`${option.label} finish. ${option.description}${available ? "" : " Starter plan required."}`}
                                            disabled={!available}
                                            onClick={() => {
                                                if (available) setBackground(option.id);
                                            }}
                                        >
                                            <span
                                                className={`${styles.backgroundSwatch} ${option.kind === "transparent" ? styles.backgroundSwatchTransparent : ""}`}
                                                style={
                                                    option.kind === "solid"
                                                        ? { backgroundColor: option.hex }
                                                        : undefined
                                                }
                                            />
                                            <span className={styles.backgroundCopy}>
                                                <span className={styles.backgroundTitleRow}>
                                                    <span className={styles.backgroundName}>{option.label}</span>
                                                    <span
                                                        className={`${styles.backgroundPlanBadge} ${requiresStarter ? "" : styles.backgroundPlanBadgePlaceholder}`}
                                                        aria-hidden={!requiresStarter}
                                                    >
                                                        Starter
                                                    </span>
                                                </span>
                                                <span className={styles.backgroundDescription}>
                                                    {option.description}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            {plan === FREE_PLAN && (
                                <p className={styles.finishAvailabilityNote}>
                                    White and Transparent are included on Free. Starter unlocks Porcelain, Stone, Atelier, and Noir.
                                </p>
                            )}
                        </BlockStack>
                    </BlockStack>
                </Card>

                {page.products.length === 0 ? (
                    <Card>
                        <EmptyState heading="No products found" image="" fullWidth>
                            <p>Try a different search term.</p>
                        </EmptyState>
                    </Card>
                ) : (
                    <Layout>
                        {page.products.map((product) => (
                            <Layout.Section key={product.id}>
                                <ProductCard
                                    product={product}
                                    selected={selected}
                                    selectionCap={selectionCap}
                                    onToggleImage={(img) => toggle(img, product.id)}
                                    onToggleProduct={() => toggleProduct(product)}
                                />
                            </Layout.Section>
                        ))}
                    </Layout>
                )}

                <Card>
                    <InlineStack align="center" gap="200">
                        <Pagination
                            hasPrevious={page.pageInfo.hasPreviousPage}
                            hasNext={page.pageInfo.hasNextPage}
                            previousURL={buildPageHref(page.pageInfo.startCursor, "before")}
                            nextURL={buildPageHref(page.pageInfo.endCursor, "after")}
                        />
                    </InlineStack>
                </Card>

                <div className={styles.pickerCommand}>
                    <Form method="post" action="/app/process">
                        <input type="hidden" name="background" value={background} />
                        <input type="hidden" name="idempotencyKey" value={processIdempotencyKey} />
                        {Array.from(selected.entries()).map(([imageId, meta]) => (
                            <div key={imageId}>
                                <input type="hidden" name="imageIds" value={imageId} />
                                <input type="hidden" name="productIds" value={meta.productId} />
                            </div>
                        ))}
                        <div className={styles.pickerCommandLayout}>
                            <div className={styles.pickerCommandStatus}>
                                <span className={`${styles.commandSelectionPill} ${atCap ? styles.commandSelectionPillWarning : ""}`}>
                                    {quotaExhausted ? "0 images available" : `${selected.size} / ${selectionCap} selected`}
                                </span>
                                <span className={styles.commandMeta}>
                                    {commandMetaText}
                                </span>
                            </div>
                            <div className={styles.pickerCommandActions}>
                                <button
                                    className={styles.secondaryAction}
                                    type="button"
                                    onClick={selectAllEligibleOnPage}
                                    disabled={!canSelectAllEligible || isSubmitting}
                                    aria-label="Select all eligible images on this page"
                                >
                                    Select All
                                </button>
                                <button
                                    className={styles.secondaryAction}
                                    type="button"
                                    onClick={clearSelection}
                                    disabled={selected.size === 0 || isSubmitting}
                                >
                                    Clear
                                </button>
                                {!quotaExhausted && (
                                    <button
                                        className={styles.primaryAction}
                                        type="submit"
                                        disabled={selected.size === 0 || isSubmitting}
                                    >
                                        {isSubmitting ? "Starting..." : submitText}
                                    </button>
                                )}
                            </div>
                        </div>
                    </Form>
                </div>
            </BlockStack>
        </Page>
    );
}

function getQuotaNotice({
    plan,
    quota,
    remaining,
    state,
}: {
    plan: string;
    quota: number;
    remaining: number;
    state: ReturnType<typeof getPremiumExportCapacity>["state"];
}): { title: string; copy: string } | null {
    if (state === "exhausted") {
        return {
            title: "Image capacity reached",
            copy: getQuotaExceededCopy(plan, quota),
        };
    }
    if (state === "low") {
        return {
            title: "Image capacity is running low",
            copy: `${remaining} images remaining this month. Review, compare, publishing, rollback, Jobs, and history stay available even if new processing reaches capacity.`,
        };
    }
    if (state === "approaching") {
        return {
            title: "Image capacity update",
            copy: `${remaining} images remaining this month. Plan your next catalog batch with that capacity in mind.`,
        };
    }
    return null;
}

function getQuotaExceededCopy(plan: string, quota: number): string {
    if (plan === FREE_PLAN) {
        return "Your Free plan includes 20 images per month. Start the 7-day trial for additional image capacity. Review, compare, publishing, rollback, Jobs, and history stay available.";
    }
    return `Your ${plan} plan includes ${quota} images per month. New processing pauses until your monthly reset. Review, compare, publishing, rollback, Jobs, and history stay available.`;
}

function ProductCard({
    product,
    selected,
    selectionCap,
    onToggleImage,
    onToggleProduct,
}: {
    product: ProductSummary;
    selected: Map<string, SelectedImage>;
    selectionCap: number;
    onToggleImage: (image: ProductImage) => void;
    onToggleProduct: () => void;
}) {
    const eligibleImages = product.images.filter(isEligibleImage);
    const ineligibleCount = product.images.length - eligibleImages.length;
    const productSelected =
        eligibleImages.length > 0 &&
        eligibleImages.every((i) => selected.has(i.id));
    const selectedEligibleCount = eligibleImages.filter((i) => selected.has(i.id)).length;
    const productChecked = productSelected
        ? true
        : selectedEligibleCount > 0
            ? "indeterminate"
            : false;

    return (
        <Card>
            <div className={styles.pickerProduct}>
                <div className={styles.pickerProductHeader}>
                    <div className={styles.productHeaderMain}>
                        <div className={styles.productSelectWrap}>
                            <Checkbox
                                label={product.title}
                                checked={productChecked}
                                disabled={eligibleImages.length === 0}
                                onChange={onToggleProduct}
                            />
                        </div>
                        <span
                            className={`${styles.productStatusBadge} ${product.status === "ACTIVE" ? styles.productStatusActive : styles.productStatusNeutral}`}
                        >
                            {product.status}
                        </span>
                    </div>
                    <span className={styles.productMetaText}>
                        {eligibleImages.length} eligible
                        {ineligibleCount > 0 ? ` · ${ineligibleCount} skipped` : ""}
                    </span>
                </div>

                {eligibleImages.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                        No JPG/PNG images on this product.
                    </Text>
                ) : (
                    <div className={styles.pickerGrid}>
                        {eligibleImages.map((image) => {
                            const isSelected = selected.has(image.id);
                            const selectionUnavailable = !isSelected && selected.size >= selectionCap;
                            return (
                                <button
                                    key={image.id}
                                    type="button"
                                    onClick={() => onToggleImage(image)}
                                    className={`${styles.pickerImageButton} ${isSelected ? styles.pickerImageButtonSelected : ""}`}
                                    disabled={selectionUnavailable}
                                    aria-pressed={isSelected}
                                    aria-label={`${image.altText ?? product.title} for ${product.title}. ${isSelected ? "Selected" : selectionUnavailable ? "Selection limit reached" : "Not selected"}.`}
                                >
                                    <div className={styles.pickerImageFrame}>
                                        <img
                                            className={styles.pickerImage}
                                            src={image.url}
                                            alt={image.altText ?? product.title}
                                            loading="lazy"
                                            decoding="async"
                                        />
                                    </div>
                                    {isSelected && (
                                        <span className={styles.selectionMark} aria-hidden="true">✓</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </Card>
    );
}
