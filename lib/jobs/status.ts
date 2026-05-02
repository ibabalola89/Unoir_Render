export type ImageStatusCounts = Record<string, number | undefined>;

export type SettledJobStatus = "failed" | "completed" | "published" | "partially_published";

export function resolveSettledJobStatus(counts: ImageStatusCounts): SettledJobStatus {
    const published = counts.published ?? 0;
    const publishing = counts.publishing ?? 0;
    const failedPublish = counts.failed_publish ?? 0;
    const publishOutstanding = publishing + failedPublish;
    const reviewOutstanding =
        (counts.processed ?? 0) +
        (counts.approved ?? 0) +
        (counts.rejected ?? 0) +
        (counts.failed ?? 0);

    if (published > 0 && publishOutstanding === 0 && reviewOutstanding === 0) {
        return "published";
    }
    if (published > 0 || publishOutstanding > 0) {
        return "partially_published";
    }

    const failed = counts.failed ?? 0;
    const processedish =
        (counts.processed ?? 0) +
        (counts.approved ?? 0) +
        (counts.rejected ?? 0);
    return processedish === 0 && failed > 0 ? "failed" : "completed";
}

export function countStatuses<T extends { status: string }>(items: T[]): Record<string, number> {
    return items.reduce<Record<string, number>>((acc, item) => {
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
    }, {});
}