/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test.describe("public launch pages", () => {
    test("landing page renders public trust copy without App Bridge", async ({ page }) => {
        await page.goto("/");

        await expect(page.getByRole("heading", { name: /Luxury product imagery/ })).toBeVisible();
        await expect(page.getByRole("listitem").filter({ hasText: "Review before publishing" })).toBeVisible();
        await expect(page.getByText("Original media stays intact")).toBeVisible();
        await expect(page.locator('script[src*="app-bridge"]')).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Privacy" })).toHaveCSS("text-decoration-line", "none");
        await expect(page.getByRole("link", { name: "Support" })).toHaveCSS("text-decoration-line", "none");
    });

    test("privacy and support pages expose launch-critical policy details", async ({ page }) => {
        await page.goto("/privacy");

        await expect(page).toHaveTitle(/Privacy Policy/);
        await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
        await expect(page.getByText("remove.bg")).toBeVisible();
        await expect(page.getByText(/preserve originals and support rollback/)).toBeVisible();
        await expect(page.getByRole("link", { name: "support@unoir.studio" })).toHaveAttribute(
            "href",
            "mailto:support@unoir.studio",
        );
        await expect(page.locator('script[src*="app-bridge"]')).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Support", exact: true })).toHaveCSS("text-decoration-line", "none");

        await page.goto("/support");

        await expect(page).toHaveTitle(/Support/);
        await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();
        await expect(page.getByText(/Unoir never publishes automatically/)).toBeVisible();
        await expect(page.getByText(/automatic overage billing/)).toBeVisible();
        await expect(page.getByRole("link", { name: "support@unoir.studio" })).toHaveAttribute(
            "href",
            "mailto:support@unoir.studio",
        );
        await expect(page.locator('script[src*="app-bridge"]')).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Privacy", exact: true })).toHaveCSS("text-decoration-line", "none");
    });

    test("policy links stay polished on narrow screens", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");

        await expect(page.getByRole("link", { name: "Privacy", exact: true })).toHaveCSS("text-decoration-line", "none");
        await expect(page.getByRole("link", { name: "Support", exact: true })).toHaveCSS("text-decoration-line", "none");
        await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

        await page.goto("/privacy");
        await expect(page.getByRole("link", { name: "Support", exact: true })).toHaveCSS("text-decoration-line", "none");
        await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });

    test("auth login stays outside the embedded App Bridge shell", async ({ page }) => {
        await page.goto("/auth/login");

        await expect(page.locator('script[src*="app-bridge"]')).toHaveCount(0);
        const path = new URL(page.url()).pathname;
        expect(["/", "/auth/login"]).toContain(path);

        if (path === "/auth/login") {
            await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
            await expect(page.getByLabel("Shop domain")).toBeVisible();
        } else {
            await expect(page.getByRole("heading", { name: /Luxury product imagery/ })).toBeVisible();
        }
    });
});
