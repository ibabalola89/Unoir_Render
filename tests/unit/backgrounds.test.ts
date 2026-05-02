import { describe, expect, it } from "vitest";
import {
    BACKGROUND_OPTIONS,
    DEFAULT_BACKGROUND_ID,
    FREE_BACKGROUND_IDS,
    getBackgroundOption,
    getBackgroundAccessTier,
    getAvailableBackgroundOptions,
    getBackgroundOutputContentType,
    getBackgroundOutputExtension,
    isBackgroundId,
    isBackgroundAvailableForPlan,
    STARTER_BACKGROUND_IDS,
} from "../../lib/backgrounds";

describe("BACKGROUND_OPTIONS", () => {
    it("keeps the curated finish set capped at six options", () => {
        expect(BACKGROUND_OPTIONS).toHaveLength(6);
    });

    it("keeps finish ids unique, stable, and lowercase", () => {
        const ids = BACKGROUND_OPTIONS.map((background) => background.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual([
            "white",
            "porcelain",
            "stone",
            "atelier",
            "noir",
            "transparent",
        ]);
        expect(isBackgroundId(DEFAULT_BACKGROUND_ID)).toBe(true);
        for (const id of ids) {
            expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
        }
    });

    it("keeps solid colors valid for remove.bg and transparent colorless", () => {
        for (const background of BACKGROUND_OPTIONS) {
            if (background.kind === "solid") {
                expect(background.hex).toMatch(/^#[0-9a-f]{6}$/);
            } else {
                expect(background).not.toHaveProperty("hex");
            }
        }
    });

    it("validates known backgrounds and rejects custom values", () => {
        expect(isBackgroundId("porcelain")).toBe(true);
        expect(isBackgroundId("atelier")).toBe(true);
        expect(isBackgroundId("#ff00ff")).toBe(false);
    });

    it("uses premium soft gray for atelier", () => {
        expect(getBackgroundOption("atelier")).toMatchObject({
            label: "Atelier",
            hex: "#e8e8e6",
            description: "Premium soft gray.",
        });
    });

    it("keeps White and Transparent available on Free", () => {
        expect(FREE_BACKGROUND_IDS).toEqual(["white", "transparent"]);
        expect(getAvailableBackgroundOptions("Free").map((background) => background.id)).toEqual([
            "white",
            "transparent",
        ]);
        for (const id of FREE_BACKGROUND_IDS) {
            expect(getBackgroundAccessTier(id)).toBe("free");
            expect(isBackgroundAvailableForPlan(id, "Free")).toBe(true);
            expect(isBackgroundAvailableForPlan(id, "Starter")).toBe(true);
        }
    });

    it("reserves editorial finishes for Starter", () => {
        expect(STARTER_BACKGROUND_IDS).toEqual(["porcelain", "stone", "atelier", "noir"]);
        for (const id of STARTER_BACKGROUND_IDS) {
            expect(getBackgroundAccessTier(id)).toBe("starter");
            expect(isBackgroundAvailableForPlan(id, "Free")).toBe(false);
            expect(isBackgroundAvailableForPlan(id, "Starter")).toBe(true);
        }
    });

    it("fails loudly for unknown runtime background ids", () => {
        expect(() => getBackgroundOption("mist")).toThrow(/Unknown background option/);
    });

    it("uses PNG only for transparent output", () => {
        for (const background of BACKGROUND_OPTIONS) {
            expect(getBackgroundOutputExtension(background.id)).toBe(
                background.kind === "transparent" ? "png" : "jpg",
            );
            expect(getBackgroundOutputContentType(background.id)).toBe(
                background.kind === "transparent" ? "image/png" : "image/jpeg",
            );
        }
    });
});
