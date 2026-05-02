export type BackgroundKind = "solid" | "transparent";

export interface BaseBackgroundOption {
    id: string;
    label: string;
    kind: BackgroundKind;
    description: string;
}

export interface SolidBackgroundOption extends BaseBackgroundOption {
    kind: "solid";
    hex: `#${string}`;
}

export interface TransparentBackgroundOption extends BaseBackgroundOption {
    kind: "transparent";
    hex?: never;
}

export type BackgroundOption = SolidBackgroundOption | TransparentBackgroundOption;

export type BackgroundAccessTier = "free" | "starter";

export const BACKGROUND_OPTIONS = [
    {
        id: "white",
        label: "White",
        kind: "solid",
        hex: "#ffffff",
        description: "Clean marketplace white.",
    },
    {
        id: "porcelain",
        label: "Porcelain",
        kind: "solid",
        hex: "#f7f3ea",
        description: "Soft editorial warmth.",
    },
    {
        id: "stone",
        label: "Stone",
        kind: "solid",
        hex: "#ded8cd",
        description: "Quiet luxury neutral.",
    },
    {
        id: "atelier",
        label: "Atelier",
        kind: "solid",
        hex: "#e8e8e6",
        description: "Premium soft gray.",
    },
    {
        id: "noir",
        label: "Noir",
        kind: "solid",
        hex: "#050505",
        description: "Deep premium black.",
    },
    {
        id: "transparent",
        label: "Transparent",
        kind: "transparent",
        description: "PNG cutout for design layers.",
    },
] as const satisfies readonly BackgroundOption[];

export type BackgroundId = (typeof BACKGROUND_OPTIONS)[number]["id"];

export const DEFAULT_BACKGROUND_ID: BackgroundId = "white";

export const FREE_BACKGROUND_IDS = ["white", "transparent"] as const satisfies readonly BackgroundId[];
export const STARTER_BACKGROUND_IDS = [
    "porcelain",
    "stone",
    "atelier",
    "noir",
] as const satisfies readonly BackgroundId[];

const freeBackgroundIds = new Set<string>(FREE_BACKGROUND_IDS);
const starterBackgroundIds = new Set<string>(STARTER_BACKGROUND_IDS);

export class UnknownBackgroundError extends Error {
    constructor(public readonly backgroundId: string) {
        super(`Unknown background option: ${backgroundId}`);
        this.name = "UnknownBackgroundError";
    }
}

if (BACKGROUND_OPTIONS.length > 6) {
    throw new Error("Unoir supports at most 6 curated finish options.");
}

const backgroundIds = new Set<string>();
for (const background of BACKGROUND_OPTIONS) {
    if (backgroundIds.has(background.id)) {
        throw new Error(`Duplicate background option id: ${background.id}`);
    }
    backgroundIds.add(background.id);
    if (!/^[a-z][a-z0-9-]*$/.test(background.id)) {
        throw new Error(`Invalid background option id: ${background.id}`);
    }
    if (background.kind === "solid" && !/^#[0-9a-f]{6}$/.test(background.hex)) {
        throw new Error(`Invalid solid background hex for ${background.id}: ${background.hex}`);
    }
}

const backgroundMap: ReadonlyMap<string, (typeof BACKGROUND_OPTIONS)[number]> = new Map(
    BACKGROUND_OPTIONS.map((background) => [background.id, background]),
);

export function isBackgroundId(value: string): value is BackgroundId {
    return backgroundMap.has(value);
}

export function toBackgroundId(value: string): BackgroundId | undefined {
    return isBackgroundId(value) ? value : undefined;
}

export function getBackgroundOption(id: string): (typeof BACKGROUND_OPTIONS)[number] {
    const background = backgroundMap.get(id);
    if (!background) {
        throw new UnknownBackgroundError(id);
    }
    return background;
}

export function getBackgroundAccessTier(id: BackgroundId): BackgroundAccessTier {
    return starterBackgroundIds.has(id) ? "starter" : "free";
}

export function isBackgroundAvailableForPlan(id: BackgroundId, plan: string): boolean {
    return plan === "Starter" || freeBackgroundIds.has(id);
}

export function getAvailableBackgroundOptions(plan: string): readonly BackgroundOption[] {
    if (plan === "Starter") return BACKGROUND_OPTIONS;
    return BACKGROUND_OPTIONS.filter((background) => freeBackgroundIds.has(background.id));
}

export function getBackgroundOutputExtension(id: BackgroundId): "jpg" | "png" {
    return getBackgroundOption(id).kind === "transparent" ? "png" : "jpg";
}

export function getBackgroundOutputContentType(id: BackgroundId): "image/jpeg" | "image/png" {
    return getBackgroundOutputExtension(id) === "png" ? "image/png" : "image/jpeg";
}
