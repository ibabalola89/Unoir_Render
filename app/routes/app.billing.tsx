import type { LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import {
    Page,
    BlockStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { AppNotice } from "../components/AppNotice";
import { authenticate } from "../shopify.server";
import {
    FREE_PLAN,
    PLAN_QUOTAS,
    STARTER_PLAN,
    STARTER_PRICE_USD,
    STARTER_TRIAL_DAYS,
} from "@lib/billing/plans";
import { getPremiumExportCapacity } from "@lib/billing/capacity";
import { tryGetUsageSummary } from "@lib/billing/usage";
import styles from "../styles/studio.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, billing } = await authenticate.admin(request);
    const result = await tryGetUsageSummary(session.shop, billing);
    return { result, shop: session.shop };
};

export default function BillingPage() {
    const { result, shop } = useLoaderData<typeof loader>();
    const navigation = useNavigation();
    const [search] = useSearchParams();
    const justSubscribed = search.get("subscribed") === "1";
    const error = search.get("error");
    const isStartingCheckout =
        navigation.state === "submitting" &&
        navigation.formAction?.includes("/app/billing/subscribe") === true;

    if (!result.ok) {
        return (
            <Page title="Plan & usage" backAction={{ url: "/app" }}>
                <TitleBar title="Plan & usage" />
                <AppNotice tone="warning" title="Billing check unavailable">
                    <p>
                        Shopify&apos;s Billing API is temporarily unavailable. Try
                        again shortly.
                    </p>
                </AppNotice>
            </Page>
        );
    }

    const { plan, quota, used, remaining } = result.summary;
    const capacity = getPremiumExportCapacity(result.summary);
    const progress = capacity.percentUsed;
    const quotaNotice = getQuotaNotice({ plan, quota, remaining, state: capacity.state });
    const usageSummaryText = capacity.state === "exhausted"
        ? `${quota} image monthly capacity reached`
        : `${used} of ${quota} images processed`;
    const usageDetailText = capacity.state === "exhausted"
        ? `${used} images processed this month. Resets on the 1st (UTC).`
        : `${remaining} images remaining this month. Resets on the 1st (UTC).`;

    return (
        <Page
            title="Plan & usage"
            backAction={{ url: "/app" }}
            titleMetadata={
                <span
                    className={`${styles.billingPlanPill} ${plan === STARTER_PLAN ? styles.billingPlanPillStarter : styles.billingPlanPillFree}`}
                >
                    {plan}
                </span>
            }
        >
            <TitleBar title="Plan & usage" />
            <BlockStack gap="500">
                {error === "billing-config" && (
                    <AppNotice tone="warning" title="Billing setup needs attention">
                        <p>
                            Starter checkout is not configured for this app URL yet. Check the app URL, then try again.
                        </p>
                    </AppNotice>
                )}
                {error === "billing-request" && (
                    <AppNotice tone="warning" title="Starter checkout unavailable">
                        <p>
                            Shopify could not open Starter checkout just now. Existing jobs still work; try the trial button again in a moment.
                        </p>
                    </AppNotice>
                )}
                {justSubscribed && plan === STARTER_PLAN && (
                    <AppNotice tone="success" title="Subscription active">
                        <p>You&apos;re on Starter. Your {STARTER_TRIAL_DAYS}-day trial is active.</p>
                    </AppNotice>
                )}

                {quotaNotice && (
                    <AppNotice label="Capacity status" tone="warning" title={quotaNotice.title}>
                        <p>{quotaNotice.copy}</p>
                    </AppNotice>
                )}

                <section className={styles.billingUsageCard}>
                    <div className={styles.billingUsageHeader}>
                        <h2>{shop}</h2>
                        <span>{usageSummaryText}</span>
                    </div>
                    <div
                        className={styles.billingProgressTrack}
                        aria-label={`${progress}% of monthly image capacity used`}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={progress}
                        role="progressbar"
                    >
                        <span style={{ width: `${progress}%` }} />
                    </div>
                    <p>{usageDetailText}</p>
                </section>

                {plan === FREE_PLAN ? (
                    <section className={styles.billingPlanCard}>
                        <div className={styles.billingPlanCopy}>
                            <span className={styles.billingPlanEyebrow}>Starter plan</span>
                            <h3>
                                Starter — ${STARTER_PRICE_USD}/month
                            </h3>
                            <p className={styles.billingPlanLead}>
                                {`Starter includes ${PLAN_QUOTAS[STARTER_PLAN]} images per month and unlocks Porcelain, Stone, Atelier, and Noir for a more consistent catalog look.`}
                            </p>
                            <p className={styles.billingPlanTrust}>
                                Review, rollback, and Jobs are available on every plan. There is no automatic overage billing; new processing pauses when monthly capacity is used.
                            </p>
                        </div>
                        <Form
                            className={styles.billingPlanAction}
                            method="post"
                            action={`/app/billing/subscribe?shop=${encodeURIComponent(shop)}`}
                        >
                            <button
                                className={styles.billingTrialButton}
                                disabled={isStartingCheckout}
                                type="submit"
                            >
                                {isStartingCheckout
                                    ? "Opening checkout..."
                                    : `Start ${STARTER_TRIAL_DAYS}-day trial`}
                            </button>
                        </Form>
                    </section>
                ) : (
                    <section className={`${styles.billingPlanCard} ${styles.billingPlanCardActive}`}>
                        <div className={styles.billingPlanCopy}>
                            <span className={styles.billingPlanEyebrow}>Current plan</span>
                            <h3>Starter active</h3>
                            <p className={styles.billingPlanLead}>
                                Starter catalog standardization is active. Manage or cancel from Shopify admin, under Settings → Billing.
                            </p>
                            <p className={styles.billingPlanTrust}>
                                No automatic overage billing. If monthly capacity is used, only new processing pauses.
                            </p>
                        </div>
                    </section>
                )}
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
        if (plan === FREE_PLAN) {
            return {
                title: "Free image capacity used",
                copy: `Free includes ${PLAN_QUOTAS[FREE_PLAN]} images per month. Start the ${STARTER_TRIAL_DAYS}-day trial to process more images this month. Existing jobs can still be reviewed, published, or rolled back.`,
            };
        }
        return {
            title: "Image capacity reached",
            copy: `${plan} includes ${quota} images per month. New processing pauses until your monthly reset; existing jobs remain available.`,
        };
    }
    if (state === "low") {
        return {
            title: "Image capacity is running low",
            copy: `${remaining} images remaining this month. If capacity runs out, only new processing pauses.`,
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
