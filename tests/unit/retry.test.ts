import { describe, it, expect, vi } from "vitest";
import { shopifyGraphqlWithRetry } from "../../lib/shopify/retry";

// Minimal stand-in for AdminApiContext — the helper only forwards it.
const fakeAdmin = {} as Parameters<typeof shopifyGraphqlWithRetry>[0];

describe("shopifyGraphqlWithRetry", () => {
    it("returns immediately on success", async () => {
        const handler = vi.fn().mockResolvedValue({ data: { ok: true } });
        const result = await shopifyGraphqlWithRetry(fakeAdmin, handler);
        expect(result).toEqual({ data: { ok: true } });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry on a mixed-error payload (throttled + non-throttled)", async () => {
        const handler = vi.fn().mockResolvedValue({
            data: null,
            errors: [
                { message: "Throttled", extensions: { code: "THROTTLED" } },
                { message: "Access denied", extensions: { code: "ACCESS_DENIED" } },
            ],
        });
        const result = await shopifyGraphqlWithRetry(fakeAdmin, handler);
        // The helper returns the payload verbatim — caller surfaces the error.
        expect(result.errors?.length).toBe(2);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("retries when every error is THROTTLED, then succeeds", async () => {
        const handler = vi
            .fn()
            .mockResolvedValueOnce({
                data: null,
                errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
                extensions: {
                    cost: {
                        throttleStatus: {
                            maximumAvailable: 1000,
                            currentlyAvailable: 999,
                            restoreRate: 1000,
                        },
                    },
                },
            })
            .mockResolvedValueOnce({ data: { ok: true } });
        const result = await shopifyGraphqlWithRetry(fakeAdmin, handler);
        expect(result).toEqual({ data: { ok: true } });
        expect(handler).toHaveBeenCalledTimes(2);
    });
});
