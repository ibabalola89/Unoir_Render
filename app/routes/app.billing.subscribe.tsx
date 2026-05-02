import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { redirectToEmbeddedAppUrl } from "../auth-context.server";
import { STARTER_PLAN } from "@lib/billing/plans";
import { emitTelemetryEvent, serializeError } from "@lib/telemetry";

/**
 * Subscribe action — kicks off the Shopify Billing approval flow for the
 * Starter plan. `billing.request` either returns a confirmation URL the
 * merchant must visit, or (when already subscribed) returns the active
 * subscription. We always redirect.
 *
 * GET → bounce to the billing page so this URL isn't accidentally indexed
 * or hit by a browser prefetch in a way that creates a charge.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const embeddedTarget = redirectToEmbeddedAppUrl(request, "/app/billing");
    if (embeddedTarget) return redirect(embeddedTarget);

    await authenticate.admin(request);
    return redirect("/app/billing");
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { billing, session } = await authenticate.admin(request);
    const isTest = process.env.NODE_ENV !== "production";

    if (!process.env.SHOPIFY_APP_URL) {
        console.error("[billing] SHOPIFY_APP_URL is not configured");
        emitTelemetryEvent("billing_checkout_config_missing", {
            shop: session.shop,
            missing: "SHOPIFY_APP_URL",
        }, "error");
        return redirect(`/app/billing?error=billing-config&shop=${encodeURIComponent(session.shop)}`);
    }

    // `billing.require` calls `onFailure` when there is no active subscription.
    // `billing.request` returns a Response (a redirect to Shopify's
    // confirmation URL) which we MUST return so the merchant actually lands
    // on the approval page. Shopify will re-append `?shop=...&host=...` to
    // the returnUrl after the merchant confirms.
    try {
        return await billing.require({
            plans: [STARTER_PLAN],
            isTest,
            onFailure: async () =>
                billing.request({
                    plan: STARTER_PLAN,
                    isTest,
                    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing?subscribed=1&shop=${encodeURIComponent(session.shop)}`,
                }),
        });
    } catch (err) {
        console.error("[billing] failed to request Starter subscription", {
            shop: session.shop,
            error: formatBillingError(err),
        });
        emitTelemetryEvent("billing_checkout_request_failed", {
            shop: session.shop,
            plan: STARTER_PLAN,
            ...serializeError(err),
        }, "error");
        return redirect(`/app/billing?error=billing-request&shop=${encodeURIComponent(session.shop)}`);
    }
};

function formatBillingError(err: unknown): unknown {
    if (err instanceof Error) {
        return {
            name: err.name,
            message: err.message,
            errorData: (err as { errorData?: unknown }).errorData,
            cause: (err as { cause?: unknown }).cause,
        };
    }
    return err;
}
