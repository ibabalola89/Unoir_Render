import { describe, expect, it } from "vitest";
import {
    canClaimWorkflowLock,
    resolveSettledJobStatus,
    WORKFLOW_LOCK_STALE_MS,
    workflowLockClaimWhere,
} from "../../lib/jobs/status";
import { isFinishedQueueJobState } from "../../lib/queue";

describe("resolveSettledJobStatus", () => {
    it("marks all-failed settled jobs as failed", () => {
        expect(resolveSettledJobStatus({ failed: 2 })).toBe("failed");
    });

    it("marks reviewed or processed jobs with no published media as completed", () => {
        expect(resolveSettledJobStatus({ processed: 1, rejected: 1 })).toBe("completed");
    });

    it("keeps jobs with published media and remaining review work partially published", () => {
        expect(resolveSettledJobStatus({ published: 1, processed: 1 })).toBe("partially_published");
    });

    it("keeps jobs with failed publish rows partially published", () => {
        expect(resolveSettledJobStatus({ failed_publish: 1, rejected: 1 })).toBe("partially_published");
    });

    it("marks only-published jobs as published", () => {
        expect(resolveSettledJobStatus({ published: 3 })).toBe("published");
    });

    it("keeps published media rollbackable when processing failures remain", () => {
        expect(resolveSettledJobStatus({ published: 2, failed: 1 })).toBe("partially_published");
    });
});

describe("workflow lock", () => {
    const now = Date.parse("2026-05-01T12:00:00.000Z");

    it("allows publish and rollback from any parent status except a fresh lock", () => {
        const fresh = new Date(now - 60_000);
        const stale = new Date(now - WORKFLOW_LOCK_STALE_MS - 1);
        expect(canClaimWorkflowLock("canceled", fresh, now)).toBe(true);
        expect(canClaimWorkflowLock("failed", fresh, now)).toBe(true);
        expect(canClaimWorkflowLock("queued", fresh, now)).toBe(true);
        expect(canClaimWorkflowLock("completed", fresh, now)).toBe(true);
        expect(canClaimWorkflowLock("publishing", fresh, now)).toBe(false);
        expect(canClaimWorkflowLock("publishing", stale, now)).toBe(true);
        expect(workflowLockClaimWhere("job_1", now)).toEqual({
            id: "job_1",
            OR: [
                { status: { not: "publishing" } },
                { status: "publishing", updatedAt: { lt: new Date(now - WORKFLOW_LOCK_STALE_MS) } },
            ],
        });
    });
});

describe("finished queue jobs", () => {
    it("replaces only terminal BullMQ states before a retry add", () => {
        expect(isFinishedQueueJobState("failed")).toBe(true);
        expect(isFinishedQueueJobState("completed")).toBe(true);
        expect(isFinishedQueueJobState("unknown")).toBe(true);
        expect(isFinishedQueueJobState("waiting")).toBe(false);
        expect(isFinishedQueueJobState("active")).toBe(false);
        expect(isFinishedQueueJobState("delayed")).toBe(false);
    });
});