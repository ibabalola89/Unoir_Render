import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_OPTIONS, getBackgroundOutputContentType } from "../../lib/backgrounds";

async function loadRemoveBg() {
    vi.resetModules();
    return import("../../lib/ai/removeBg");
}

describe("removeBackground", () => {
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        process.env = { ...originalEnv };
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    async function capturePayload(background: (typeof BACKGROUND_OPTIONS)[number]["id"]) {
        process.env.REMOVE_BG_API_KEY = "test-key";
        const fetchMock = vi.fn(async () =>
            new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: { "content-type": "image/jpeg" },
            }),
        );
        globalThis.fetch = fetchMock as typeof fetch;

        const { removeBackground } = await loadRemoveBg();
        await removeBackground({ imageUrl: "https://example.com/image.jpg", background });

        const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        return call[1].body as FormData;
    }

    async function captureResult(background: (typeof BACKGROUND_OPTIONS)[number]["id"]) {
        process.env.REMOVE_BG_API_KEY = "test-key";
        globalThis.fetch = vi.fn(async () =>
            new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: { "content-type": "application/octet-stream" },
            }),
        ) as typeof fetch;

        const { removeBackground } = await loadRemoveBg();
        return removeBackground({ imageUrl: "https://example.com/image.jpg", background });
    }

    it("sends the Atelier premium soft gray bg_color to remove.bg", async () => {
        const form = await capturePayload("atelier");
        expect(form.get("format")).toBe("jpg");
        expect(form.get("bg_color")).toBe("e8e8e6");
    });

    it("maps every curated finish to the expected remove.bg payload", async () => {
        for (const background of BACKGROUND_OPTIONS) {
            const form = await capturePayload(background.id);
            expect(form.get("format")).toBe(background.kind === "transparent" ? "png" : "jpg");
            expect(form.get("bg_color")).toBe(
                background.kind === "transparent" ? null : background.hex.replace("#", ""),
            );
        }
    });

    it("maps every curated finish to authoritative output content type", async () => {
        for (const background of BACKGROUND_OPTIONS) {
            const result = await captureResult(background.id);
            expect(result.contentType).toBe(getBackgroundOutputContentType(background.id));
        }
    });

    it("stores transparent responses as image/png even if the provider header is wrong", async () => {
        process.env.REMOVE_BG_API_KEY = "test-key";
        globalThis.fetch = vi.fn(async () =>
            new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: { "content-type": "image/jpeg" },
            }),
        ) as typeof fetch;

        const { removeBackground } = await loadRemoveBg();
        const result = await removeBackground({
            imageUrl: "https://example.com/image.jpg",
            background: "transparent",
        });

        expect(result.contentType).toBe("image/png");
    });

    it("does not silently fall back to white for stale background ids", async () => {
        process.env.REMOVE_BG_API_KEY = "test-key";
        const { removeBackground } = await loadRemoveBg();

        await expect(
            removeBackground({ imageUrl: "https://example.com/image.jpg", background: "mist" as never }),
        ).rejects.toThrow(/Unknown background option/);
    });
});