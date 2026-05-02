import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Page, BlockStack, Badge, Button } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { AppNotice } from "../components/AppNotice";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { FREE_PLAN, STARTER_PLAN } from "@lib/billing/plans";
import { getPremiumExportCapacity } from "@lib/billing/capacity";
import { tryGetUsageSummary } from "@lib/billing/usage";
import { shouldShowHomeUsagePanel } from "@lib/ui/homeUsage";
import styles from "../styles/studio.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const [result, jobCount] = await Promise.all([
    tryGetUsageSummary(session.shop, billing),
    prisma.processingJob.count({ where: { shop: session.shop } }),
  ]);
  return { shop: session.shop, result, hasJobs: jobCount > 0 };
};

export default function Index() {
  const { shop, result, hasJobs } = useLoaderData<typeof loader>();
  if (!result.ok) {
    return (
      <Page>
        <TitleBar title="Unoir Studio" />
        <AppNotice tone="warning" title="Billing check unavailable">
          <p>
            We couldn&apos;t reach Shopify&apos;s Billing API. Reload in a moment
            — processing is paused until we can verify your plan.
          </p>
        </AppNotice>
      </Page>
    );
  }
  const { plan, quota, used, remaining } = result.summary;
  const capacity = getPremiumExportCapacity(result.summary);
  const progress = capacity.percentUsed;
  const overQuota = capacity.state === "exhausted";
  const showUsagePanel = shouldShowHomeUsagePanel({
    plan,
    capacityState: capacity.state,
  });
  const usageHeadline = overQuota
    ? `${quota} image monthly capacity reached`
    : `${used} of ${quota} images processed`;
  const capacityMessage = getCapacityMessage({
    plan,
    quota,
    remaining,
    state: capacity.state,
    used,
  });
  const onboardingShellClassName = showUsagePanel
    ? styles.onboardingShell
    : `${styles.onboardingShell} ${styles.onboardingShellSingle}`;

  return (
    <Page>
      <TitleBar title="Unoir Studio" />
      <BlockStack gap="500">
        {overQuota && plan === FREE_PLAN && (
          <AppNotice
            action={{ label: "View plans", to: "/app/billing" }}
            label="Monthly capacity"
            title="Free image capacity used"
            tone="warning"
            compact
          >
            <p>
              Your Free plan has used its monthly image capacity. Start the
              7-day trial to process more images this month. Existing jobs,
              review, publishing, and rollback stay available.
            </p>
          </AppNotice>
        )}

        <section className={onboardingShellClassName}>
          <div className={styles.onboardingIntro}>
            <div>
              <div className={styles.eyebrow}>Catalog standardization</div>
              <h2 className={styles.launchTitle}>
                {hasJobs
                  ? "Catalog-ready images, reviewed before publishing."
                  : "Standardize your first product set."}
              </h2>
              <p className={styles.launchSummary}>
                {hasJobs
                  ? "Unoir helps product photos look consistent across your catalog. Original media stays in place unless you choose to publish an approved result."
                  : "Choose a curated finish, review every result, then publish only the images you approve."}
              </p>
              <p className={styles.trustStatement}>Original product media stays intact.</p>
            </div>
            <div className={styles.launchActions}>
              <Link className={styles.primaryAction} to="/app/picker">
                Select products
              </Link>
              <Link className={styles.secondaryAction} to="/app/jobs">
                View jobs
              </Link>
            </div>
          </div>

          {showUsagePanel && (
            <div className={styles.onboardingUsage}>
              <div className={styles.onboardingUsageHeader}>
                <div>
                  <span className={styles.usageShopMeta}>{shop}</span>
                  <strong>{usageHeadline}</strong>
                </div>
                <Badge tone={plan === STARTER_PLAN ? "success" : "info"}>{plan}</Badge>
              </div>
              <div
                className={styles.usageMeter}
                aria-label={`${progress}% of monthly image capacity used`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                {progress > 0 && <span style={{ width: `${progress}%` }} />}
              </div>
              <p>{capacityMessage}</p>
              <Button url="/app/billing">Plan & usage</Button>
            </div>
          )}
        </section>

        {!hasJobs && (
          <section className={styles.firstRunGuide}>
            <div className={styles.firstRunCopy}>
              <div className={styles.eyebrow}>First run</div>
              <h3>Process your first products.</h3>
              <p>
                Select a small set of products, apply a finish, and review
                results before anything publishes.
              </p>
              <Link
                className={`${styles.primaryAction} ${styles.firstRunAction}`}
                to="/app/picker"
              >
                Open product selector
              </Link>
            </div>
            <div className={styles.firstRunSequence}>
              {FIRST_RUN_STEPS.map((step, index) => (
                <div className={styles.firstRunStep} key={step.title}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {hasJobs && (
          <section className={styles.workflowSection}>
            <div className={styles.workflowHeader}>
              <h3>How Unoir keeps your catalog safe</h3>
              <p>Unoir never changes Shopify media until you approve and publish.</p>
            </div>
            <div className={styles.onboardingSteps}>
              {ONBOARDING_STEPS.map((step, index) => (
                <div className={styles.onboardingStep} key={step.title}>
                  <span>{index + 1}</span>
                  <strong>{step.title}</strong>
                  <p>{step.copy}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </BlockStack>
    </Page>
  );
}

const ONBOARDING_STEPS = [
  {
    title: "Connect Shopify",
    copy: "Work directly with product images from your admin.",
  },
  {
    title: "Select products",
    copy: "Choose eligible JPG and PNG images in controlled batches.",
  },
  {
    title: "Choose finish",
    copy: "Apply White, Porcelain, Stone, Atelier, Noir, or Transparent.",
  },
  {
    title: "Review results",
    copy: "Compare original and processed images before approving.",
  },
  {
    title: "Publish safely",
    copy: "Append approved images or use one as the primary product image.",
  },
] as const;

function getCapacityMessage({
  plan,
  quota,
  remaining,
  state,
  used,
}: {
  plan: string;
  quota: number;
  remaining: number;
  state: ReturnType<typeof getPremiumExportCapacity>["state"];
  used: number;
}): string {
  if (state === "exhausted") {
    return `${used} images processed this month. ${plan} includes ${quota} images per month. New processing pauses until reset; existing jobs can still be reviewed, published, or rolled back.`;
  }
  if (state === "low") {
    return `${remaining} images remaining this month. If capacity runs out, only new processing pauses.`;
  }
  if (state === "approaching") {
    return `${remaining} images remaining this month. Plan your next catalog batch with that capacity in mind.`;
  }
  return `${remaining} images remaining this month.`;
}

const FIRST_RUN_STEPS = [
  {
    title: "Standardize product photos",
    copy: "Create a consistent catalog look from selected Shopify product images.",
  },
  {
    title: "Choose curated finishes",
    copy: "Start with White or Transparent, then unlock editorial finishes on Starter.",
  },
  {
    title: "Review before publishing",
    copy: "Compare every output and approve only what belongs in your catalog.",
  },
  {
    title: "Keep original media intact",
    copy: "Unoir adds approved outputs without replacing the source images.",
  },
  {
    title: "Begin with a focused batch",
    copy: "Select a few eligible images and review the results before publishing.",
  },
] as const;
