import dns from "node:dns/promises";

const appUrl = (process.env.PRODUCTION_SMOKE_APP_URL || process.env.SHOPIFY_APP_URL || "https://www.unoir.studio").trim().replace(/\/$/, "");
const cdnUrl = (process.env.PRODUCTION_SMOKE_CDN_URL || process.env.STORAGE_PUBLIC_BASE_URL || "https://cdn.unoir.studio").trim().replace(/\/$/, "");
const timeoutMs = Number.parseInt(process.env.PRODUCTION_SMOKE_TIMEOUT_MS || "20000", 10);

const errors = [];
let appHostname;
let cdnHostname;

try {
    const url = new URL(appUrl);
    appHostname = url.hostname;
    if (url.protocol !== "https:") {
        errors.push("PRODUCTION_SMOKE_APP_URL / SHOPIFY_APP_URL must use https:// for production smoke testing");
    }
} catch {
    errors.push("PRODUCTION_SMOKE_APP_URL / SHOPIFY_APP_URL must be a valid URL");
}

try {
    const url = new URL(cdnUrl);
    cdnHostname = url.hostname;
    if (url.protocol !== "https:") {
        errors.push("PRODUCTION_SMOKE_CDN_URL / STORAGE_PUBLIC_BASE_URL must use https:// for production smoke testing");
    }
} catch {
    errors.push("PRODUCTION_SMOKE_CDN_URL / STORAGE_PUBLIC_BASE_URL must be a valid URL");
}

if (errors.length === 0) {
    await checkDns("app DNS", appHostname);
    await checkDns("public CDN DNS", cdnHostname);
}

if (errors.length === 0) {
    await checkJson("liveness", "/healthz", (body) => {
        requireOk(body, "healthz");
        requireCheck(body, "db");
    });

    await checkJson("deep health", "/health", (body) => {
        requireOk(body, "health");
        for (const checkName of ["db", "redis", "storage", "removeBg", "worker"]) {
            requireCheck(body, checkName);
        }
    });

    await checkJson("public CDN health", "/health?cdn=1", (body) => {
        requireOk(body, "health?cdn=1");
        for (const checkName of ["db", "redis", "storage", "storageCdn", "removeBg", "worker"]) {
            requireCheck(body, checkName);
        }
    });

    await checkHtml("landing page", "/", "Unoir Studio", {
        forbiddenText: "shopifycloud/app-bridge.js",
    });
    await checkHtml("privacy page", "/privacy", "Privacy Policy", {
        forbiddenText: "shopifycloud/app-bridge.js",
    });
    await checkHtml("support page", "/support", "support@unoir.studio", {
        forbiddenText: "shopifycloud/app-bridge.js",
    });
    await checkRedirect("production login redirect", "/auth/login", "/");
}

if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
}

console.log(`Production smoke preflight passed for ${appUrl}.`);

async function checkDns(label, hostname) {
    try {
        await dns.lookup(hostname);
    } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? ` ${err.code}` : "";
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${label} ${hostname}: DNS lookup failed${code} (${message})`);
    }
}

async function checkJson(label, path, validate) {
    const { response, error } = await fetchWithTimeout(`${appUrl}${path}`);
    if (error) {
        errors.push(`${label} ${path}: ${error}`);
        return;
    }
    if (!response.ok) {
        errors.push(`${label} ${path} returned ${response.status} ${response.statusText}`);
        return;
    }
    try {
        validate(await response.json());
    } catch (err) {
        errors.push(`${label} ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

async function checkHtml(label, path, requiredText, options = {}) {
    const { response, error } = await fetchWithTimeout(`${appUrl}${path}`);
    if (error) {
        errors.push(`${label} ${path}: ${error}`);
        return;
    }
    if (!response.ok) {
        errors.push(`${label} ${path} returned ${response.status} ${response.statusText}`);
        return;
    }
    const text = await response.text();
    if (!text.includes(requiredText)) {
        errors.push(`${label} ${path} did not include expected text: ${requiredText}`);
    }
    if (options.forbiddenText && text.includes(options.forbiddenText)) {
        errors.push(`${label} ${path} included forbidden text: ${options.forbiddenText}`);
    }
}

async function checkRedirect(label, path, expectedLocation) {
    const { response, error } = await fetchWithTimeout(`${appUrl}${path}`, {
        redirect: "manual",
    });
    if (error) {
        errors.push(`${label} ${path}: ${error}`);
        return;
    }
    if (response.status < 300 || response.status >= 400) {
        errors.push(`${label} ${path} expected redirect but returned ${response.status} ${response.statusText}`);
        return;
    }
    const location = response.headers.get("location");
    if (location !== expectedLocation && location !== `${appUrl}${expectedLocation}`) {
        errors.push(`${label} ${path} redirected to ${location ?? "missing location"}, expected ${expectedLocation}`);
    }
}

async function fetchWithTimeout(url, init = {}) {
    try {
        const response = await fetch(url, {
            ...init,
            cache: "no-store",
            signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000),
        });
        return { response };
    } catch (err) {
        return { error: describeFetchError(err) };
    }
}

function describeFetchError(err) {
    if (!(err instanceof Error)) return String(err);
    const cause = err.cause instanceof Error ? ` (${err.cause.message})` : "";
    return `${err.message}${cause}`;
}

function requireOk(body, name) {
    if (!body || body.ok !== true) {
        throw new Error(`${name} response did not report ok=true`);
    }
}

function requireCheck(body, checkName) {
    const result = body?.checks?.[checkName];
    if (!result || result.ok !== true) {
        const detail = result?.error ? `: ${result.error}` : "";
        throw new Error(`${checkName} check failed or was missing${detail}`);
    }
}
