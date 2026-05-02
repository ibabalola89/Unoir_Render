import type { UsageSummary } from "./usage";

export type PremiumExportCapacityState = "available" | "approaching" | "low" | "exhausted";

export interface PremiumExportCapacity {
    state: PremiumExportCapacityState;
    percentUsed: number;
    remaining: number;
}

export function getPremiumExportCapacity(summary: UsageSummary): PremiumExportCapacity {
    const percentUsed = Math.min(
        100,
        Math.round((summary.used / Math.max(1, summary.quota)) * 100),
    );
    if (summary.remaining <= 0 || percentUsed >= 100) {
        return { state: "exhausted", percentUsed, remaining: summary.remaining };
    }
    if (percentUsed >= 90) {
        return { state: "low", percentUsed, remaining: summary.remaining };
    }
    if (percentUsed >= 80) {
        return { state: "approaching", percentUsed, remaining: summary.remaining };
    }
    return { state: "available", percentUsed, remaining: summary.remaining };
}