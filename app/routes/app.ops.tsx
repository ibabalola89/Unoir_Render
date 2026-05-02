import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
    Badge,
    BlockStack,
    Card,
    InlineGrid,
    InlineStack,
    Page,
    Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkRemoveBgAccount } from "@lib/ai/removeBg";
import { getBgRemovalQueue } from "@lib/queue";
import { getRedisConnection } from "@lib/queue/connection";
import { checkPublicStorageAccess, checkStorageBucket } from "@lib/storage";
import { isOpsShopAllowed } from "@lib/ops/access";

interface CheckResult {
    ok: boolean;
    detail: string;
}

const CHECK_TIMEOUT_MS = 2500;
const CDN_CHECK_TIMEOUT_MS = 15_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    if (!isOpsShopAllowed(session.shop)) {
        throw new Response("Not found", { status: 404 });
    }
    const url = new URL(request.url);
    const includeCdn = url.searchParams.get("cdn") === "1";

    const [queueCounts, workerCount, redis, storage, storageCdn, removeBg, jobCounts, imageStats] = await Promise.all([
        getQueueCounts(),
        getWorkerCount(),
        check("Redis", () => getRedisConnection().ping()),
        check("Storage", () => checkStorageBucket()),
        includeCdn
            ? check("Public CDN", () => checkPublicStorageAccess(), CDN_CHECK_TIMEOUT_MS)
            : Promise.resolve({ ok: true, detail: "Not checked. Open /app/ops?cdn=1 to run the write/read probe." } satisfies CheckResult),
        check("remove.bg", () => checkRemoveBgAccount()),
        getJobCounts(),
        getImageStats(),
    ]);

    return json({
        generatedAt: new Date().toISOString(),
        queueCounts,
        workerCount,
        checks: { redis, storage, storageCdn, removeBg },
        jobCounts,
        imageStats,
    });
};

export default function OpsRoute() {
    const data = useLoaderData<typeof loader>();
    const workerOnline = data.workerCount > 0;
    const failedJobs = data.queueCounts.failed + data.imageStats.failedProcessing + data.imageStats.failedPublish;

    return (
        <Page title="Operations" subtitle="Internal production readiness signals.">
            <TitleBar title="Operations" />
            <BlockStack gap="500">
                <Card>
                    <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h2" variant="headingMd">System status</Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                                {`Updated ${new Date(data.generatedAt).toLocaleString()}`}
                            </Text>
                        </InlineStack>
                        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
                            <MetricCard label="Workers online" value={String(data.workerCount)} tone={workerOnline ? "success" : "critical"} />
                            <MetricCard label="Queue waiting" value={String(data.queueCounts.waiting)} tone={data.queueCounts.waiting > 0 ? "attention" : "success"} />
                            <MetricCard label="Queue active" value={String(data.queueCounts.active)} tone="info" />
                            <MetricCard label="Failures tracked" value={String(failedJobs)} tone={failedJobs > 0 ? "critical" : "success"} />
                        </InlineGrid>
                    </BlockStack>
                </Card>

                <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                    <DependencyCard name="Redis" result={data.checks.redis} />
                    <DependencyCard name="Storage" result={data.checks.storage} />
                    <DependencyCard name="Public CDN" result={data.checks.storageCdn} />
                    <DependencyCard name="remove.bg" result={data.checks.removeBg} />
                </InlineGrid>

                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                    <Card>
                        <BlockStack gap="300">
                            <Text as="h2" variant="headingMd">BullMQ</Text>
                            <MetricRows rows={[
                                ["Waiting", data.queueCounts.waiting],
                                ["Active", data.queueCounts.active],
                                ["Delayed", data.queueCounts.delayed],
                                ["Completed", data.queueCounts.completed],
                                ["Failed", data.queueCounts.failed],
                            ]} />
                        </BlockStack>
                    </Card>

                    <Card>
                        <BlockStack gap="300">
                            <Text as="h2" variant="headingMd">Jobs</Text>
                            <MetricRows rows={[
                                ["Queued", data.jobCounts.queued],
                                ["Processing", data.jobCounts.processing],
                                ["Completed", data.jobCounts.completed],
                                ["Publishing", data.jobCounts.publishing],
                                ["Partially published", data.jobCounts.partially_published],
                                ["Published", data.jobCounts.published],
                                ["Failed", data.jobCounts.failed],
                                ["Canceled", data.jobCounts.canceled],
                            ]} />
                        </BlockStack>
                    </Card>
                </InlineGrid>

                <Card>
                    <BlockStack gap="300">
                        <Text as="h2" variant="headingMd">Recovery and publish signals</Text>
                        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
                            <MetricCard label="Processing failures" value={String(data.imageStats.failedProcessing)} tone={data.imageStats.failedProcessing > 0 ? "critical" : "success"} />
                            <MetricCard label="Publish failures" value={String(data.imageStats.failedPublish)} tone={data.imageStats.failedPublish > 0 ? "critical" : "success"} />
                            <MetricCard label="Recovered images" value={String(data.imageStats.recovered)} tone="info" />
                            <MetricCard label="Recovery cap hit" value={String(data.imageStats.recoveryCapExceeded)} tone={data.imageStats.recoveryCapExceeded > 0 ? "critical" : "success"} />
                        </InlineGrid>
                    </BlockStack>
                </Card>
            </BlockStack>
        </Page>
    );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: "success" | "critical" | "attention" | "info" }) {
    return (
        <Card>
            <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
                    <Badge tone={tone}>{toneLabel(tone)}</Badge>
                </InlineStack>
                <Text as="p" variant="heading2xl">{value}</Text>
            </BlockStack>
        </Card>
    );
}

function DependencyCard({ name, result }: { name: string; result: CheckResult }) {
    return (
        <Card>
            <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">{name}</Text>
                    <Badge tone={result.ok ? "success" : "critical"}>{result.ok ? "OK" : "Issue"}</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone={result.ok ? "subdued" : "critical"}>
                    {result.detail}
                </Text>
            </BlockStack>
        </Card>
    );
}

function MetricRows({ rows }: { rows: Array<[string, number]> }) {
    return (
        <BlockStack gap="200">
            {rows.map(([label, value]) => (
                <InlineStack key={label} align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd">{label}</Text>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{value}</Text>
                </InlineStack>
            ))}
        </BlockStack>
    );
}

function toneLabel(tone: "success" | "critical" | "attention" | "info"): string {
    if (tone === "success") return "OK";
    if (tone === "critical") return "Watch";
    if (tone === "attention") return "Busy";
    return "Info";
}

async function getQueueCounts() {
    try {
        const queue = getBgRemovalQueue();
        const counts = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");
        return {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
        };
    } catch {
        return { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 };
    }
}

async function getWorkerCount(): Promise<number> {
    try {
        return await getBgRemovalQueue().getWorkersCount();
    } catch {
        return 0;
    }
}

async function getJobCounts() {
    const counts = await prisma.processingJob.groupBy({
        by: ["status"],
        _count: { _all: true },
    });
    const map = Object.fromEntries(counts.map((count) => [count.status, count._count._all]));
    return {
        queued: map.queued ?? 0,
        processing: map.processing ?? 0,
        completed: map.completed ?? 0,
        publishing: map.publishing ?? 0,
        partially_published: map.partially_published ?? 0,
        published: map.published ?? 0,
        failed: map.failed ?? 0,
        canceled: map.canceled ?? 0,
    };
}

async function getImageStats() {
    const [failedProcessing, failedPublish, recovered, recoveryCapExceeded] = await Promise.all([
        prisma.processedImage.count({ where: { status: "failed" } }),
        prisma.processedImage.count({ where: { status: "failed_publish" } }),
        prisma.processedImage.count({ where: { recoveryAttempts: { gt: 0 } } }),
        prisma.processedImage.count({ where: { recoveryReason: "max-recovery-attempts-exceeded" } }),
    ]);
    return { failedProcessing, failedPublish, recovered, recoveryCapExceeded };
}

async function check(name: string, fn: () => Promise<unknown>, timeoutMs = CHECK_TIMEOUT_MS): Promise<CheckResult> {
    try {
        await withTimeout(fn(), timeoutMs, `${name} check timed out`);
        return { ok: true, detail: "Connected" };
    } catch (err) {
        return {
            ok: false,
            detail: err instanceof Error ? err.message : String(err),
        };
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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
