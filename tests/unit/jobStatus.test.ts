import { describe, expect, it } from "vitest";
import { resolveSettledJobStatus } from "../../lib/jobs/status";

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
});