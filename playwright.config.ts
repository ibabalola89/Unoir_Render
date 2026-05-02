import { defineConfig } from "@playwright/test";

/**
 * Playwright config for Unoir E2E.
 *
 * Real Shopify Admin embedded testing requires a long-lived dev store and
 * explicit fixture env. See `tests/e2e/loop.spec.ts`; it fails fast instead of
 * silently skipping when those fixtures are not configured.
 *
 * Run locally with: `npm run test:e2e` (you must have `npm run dev` running
 * separately, or set up `webServer` here once the auth fixtures are ready).
 */
export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 60_000,
    expect: { timeout: 5_000 },
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: "list",
    use: {
        baseURL: process.env.UNOIR_BASE_URL ?? "https://localhost:3458",
        ignoreHTTPSErrors: true,
        trace: "retain-on-failure",
    },
});
