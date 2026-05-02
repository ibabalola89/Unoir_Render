import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BACKGROUND_OPTIONS, getBackgroundOutputExtension } from "../../lib/backgrounds";

/**
 * The storage module reads env at first use and memoizes the result. Each
 * test must re-import via `vi.resetModules()` so we can flip env vars.
 */
async function loadStorage() {
    vi.resetModules();
    return import("../../lib/storage/index");
}

describe("getPublishUrl", () => {
    const origEnv = { ...process.env };
    beforeEach(() => {
        process.env = { ...origEnv };
    });
    afterEach(() => {
        process.env = { ...origEnv };
    });

    it("returns a stable public URL when STORAGE_PUBLIC_BASE_URL is set", async () => {
        process.env.STORAGE_PUBLIC_BASE_URL = "https://cdn.unoir.app/";
        const { getPublishUrl } = await loadStorage();
        await expect(getPublishUrl("processed/abc.png")).resolves.toBe(
            "https://cdn.unoir.app/processed/abc.png",
        );
    });

    it("throws on a malformed STORAGE_PUBLIC_BASE_URL", async () => {
        process.env.STORAGE_PUBLIC_BASE_URL = "not a url";
        const { getPublishUrl } = await loadStorage();
        await expect(getPublishUrl("k")).rejects.toThrow(/STORAGE_PUBLIC_BASE_URL/);
    });

    it("throws in production when STORAGE_PUBLIC_BASE_URL is not set", async () => {
        process.env.STORAGE_PUBLIC_BASE_URL = "";
        process.env.NODE_ENV = "production";
        const { getPublishUrl } = await loadStorage();
        await expect(getPublishUrl("k")).rejects.toThrow(/STORAGE_PUBLIC_BASE_URL/);
    });
});

describe("getPublicUrl", () => {
    const origEnv = { ...process.env };
    beforeEach(() => {
        process.env = { ...origEnv };
    });
    afterEach(() => {
        process.env = { ...origEnv };
    });

    it("uses STORAGE_PUBLIC_BASE_URL without leaving a double slash", async () => {
        process.env.STORAGE_PUBLIC_BASE_URL = "https://cdn.unoir.studio/";
        const { getPublicUrl } = await loadStorage();
        await expect(getPublicUrl("processed/job/image.png")).resolves.toBe(
            "https://cdn.unoir.studio/processed/job/image.png",
        );
    });
});

describe("processed object keys", () => {
    it("uses jpg keys for solid backgrounds and png keys for transparent", async () => {
        const { buildProcessedKey } = await loadStorage();

        for (const background of BACKGROUND_OPTIONS) {
            const ext = getBackgroundOutputExtension(background.id);
            expect(buildProcessedKey("job_1", "image_1", ext)).toBe(`processed/job_1/image_1.${ext}`);
            expect(ext).toBe(background.kind === "transparent" ? "png" : "jpg");
        }
    });
});
