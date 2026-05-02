/**
 * remove.bg API client.
 *
 * V1 hardcoded provider — do NOT abstract until/unless a second provider is needed.
 * Docs: https://www.remove.bg/api
 */

import {
    getBackgroundOption,
    getBackgroundOutputContentType,
    getBackgroundOutputExtension,
    type BackgroundId,
} from "../backgrounds";

const REMOVE_BG_ENDPOINT = "https://api.remove.bg/v1.0/removebg";
const REMOVE_BG_ACCOUNT_ENDPOINT = "https://api.remove.bg/v1.0/account";

export type RemoveBgBackground = BackgroundId;

export interface RemoveBgInput {
    /** Public URL of the source image. */
    imageUrl: string;
    background: RemoveBgBackground;
}

export interface RemoveBgResult {
    imageBuffer: Buffer;
    contentType: string;
    /** remove.bg credit charge for this call (from `X-Credits-Charged` header). */
    creditsCharged: number;
}

export class RemoveBgError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly retryable: boolean,
    ) {
        super(message);
        this.name = "RemoveBgError";
    }
}

function getApiKey(): string {
    const key = process.env.REMOVE_BG_API_KEY;
    if (!key) {
        throw new Error("REMOVE_BG_API_KEY is not set");
    }
    return key;
}

export async function checkRemoveBgAccount(): Promise<void> {
    const response = await fetch(REMOVE_BG_ACCOUNT_ENDPOINT, {
        method: "GET",
        headers: {
            "X-Api-Key": getApiKey(),
        },
        signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`;
        try {
            const body = (await response.json()) as {
                errors?: Array<{ title?: string; detail?: string }>;
            };
            const messages = body.errors
                ?.map((error) => error.detail || error.title)
                .filter(Boolean);
            if (messages?.length) detail = messages.join("; ");
        } catch {
            // ignore body parse error
        }

        throw new Error(`remove.bg credentials rejected: ${detail}`);
    }
}

/**
 * Calls remove.bg with the given image URL and background.
 *
 * - Solid curated finish → `bg_color=<hex>` (returns JPG)
 * - Transparent → no bg_color (returns PNG)
 *
 * Throws `RemoveBgError` with `retryable=true` for 429/5xx, false otherwise.
 */
export async function removeBackground(input: RemoveBgInput): Promise<RemoveBgResult> {
    const background = getBackgroundOption(input.background);
    const form = new FormData();
    form.set("image_url", input.imageUrl);
    form.set("size", "auto");
    form.set("format", getBackgroundOutputExtension(input.background));
    if (background.kind === "solid") {
        form.set("bg_color", background.hex.replace("#", ""));
    }

    const response = await fetch(REMOVE_BG_ENDPOINT, {
        method: "POST",
        headers: {
            "X-Api-Key": getApiKey(),
        },
        body: form,
        signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        let detail = `${response.status} ${response.statusText}`;
        try {
            const body = (await response.json()) as {
                errors?: Array<{ title?: string; detail?: string }>;
            };
            if (body.errors?.length) {
                detail = body.errors.map((e) => e.detail || e.title).filter(Boolean).join("; ");
            }
        } catch {
            // ignore body parse error
        }
        throw new RemoveBgError(`remove.bg failed: ${detail}`, response.status, retryable);
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = getBackgroundOutputContentType(input.background);
    const creditsCharged = Number(response.headers.get("x-credits-charged") ?? 1);

    return {
        imageBuffer: Buffer.from(arrayBuffer),
        contentType,
        creditsCharged: Number.isFinite(creditsCharged) ? creditsCharged : 1,
    };
}
