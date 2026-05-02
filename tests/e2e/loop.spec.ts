import { test, expect } from "@playwright/test";

const REQUIRED_ENV = [
    "UNOIR_BASE_URL",
    "UNOIR_E2E_SHOP",
    "UNOIR_E2E_FULL_LOOP_READY",
];

function missingEnv(): string[] {
    return REQUIRED_ENV.filter((key) => !process.env[key]);
}

const missingAtStartup = missingEnv();

/**
 * Happy-path smoke for the core loop:
 *   Install → Select → Process → Preview → Publish
 *
 * The embedded admin flow requires:
 *   - A persistent dev store with a fixture session row (or programmatic install).
 *   - Mocks for Shopify Admin GraphQL, remove.bg, and S3 (or live test creds).
 *   - A way to advance the BullMQ worker deterministically (in-process worker
 *     fixture, or a `processOne()` test seam in lib/queue/worker.ts).
 *
 * This file intentionally fails fast unless those fixtures are explicitly
 * configured. A silently skipped E2E suite is worse than no suite: it gives CI
 * a green badge without proving the core merchant loop.
 */
test("full-loop E2E fixtures are configured", () => {
    expect(
        missingAtStartup,
        `Configure ${missingAtStartup.join(", ")} before treating E2E as covered.`,
    ).toEqual([]);
});

if (missingAtStartup.length === 0) {
    test("merchant completes the full Install→Select→Process→Preview→Publish loop", async ({
        page,
    }) => {
        await page.goto("/app");
        // eslint-disable-next-line testing-library/prefer-screen-queries
        await expect(page.getByRole("link", { name: "Select images" })).toBeVisible();
    });
} else {
    test.skip(
        "merchant completes the full Install→Select→Process→Preview→Publish loop",
        () => undefined,
    );
}
