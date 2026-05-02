const required = [
    "NODE_ENV",
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "SCOPES",
    "DATABASE_URL",
    "REDIS_URL",
    "REMOVE_BG_API_KEY",
    "STORAGE_BUCKET",
    "STORAGE_REGION",
    "STORAGE_PUBLIC_BASE_URL",
    "INTERNAL_OPS_SHOPS",
];

const shopDomainPattern = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

const missing = required.filter((key) => !process.env[key]?.trim());
if (!process.env.STORAGE_ACCESS_KEY?.trim() && !process.env.STORAGE_ACCESS_KEY_ID?.trim()) {
    missing.push("STORAGE_ACCESS_KEY or STORAGE_ACCESS_KEY_ID");
}
if (!process.env.STORAGE_SECRET_KEY?.trim() && !process.env.STORAGE_SECRET_ACCESS_KEY?.trim()) {
    missing.push("STORAGE_SECRET_KEY or STORAGE_SECRET_ACCESS_KEY");
}
if (!process.env.STORAGE_ENDPOINT?.trim() && !process.env.STORAGE_ACCOUNT_ID?.trim()) {
    missing.push("STORAGE_ENDPOINT or STORAGE_ACCOUNT_ID");
}
if (missing.length > 0) {
    console.error(`Missing production env vars: ${missing.join(", ")}`);
    process.exit(1);
}

const errors = [];
const placeholderPattern = /^(replace_me|changeme|change_me|todo|placeholder|example)$/i;
const placeholderFragmentPattern = /(replace_me|changeme|change_me|placeholder)/i;

for (const key of required) {
    const value = process.env[key]?.trim() ?? "";
    if (placeholderPattern.test(value) || placeholderFragmentPattern.test(value)) {
        errors.push(`${key} must be replaced with a real production value`);
    }
}

for (const key of ["STORAGE_ACCESS_KEY", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_KEY", "STORAGE_SECRET_ACCESS_KEY", "STORAGE_ACCOUNT_ID"]) {
    const value = process.env[key]?.trim();
    if (value && (placeholderPattern.test(value) || placeholderFragmentPattern.test(value))) {
        errors.push(`${key} must be replaced with a real production value`);
    }
}

if (process.env.NODE_ENV !== "production") {
    errors.push("NODE_ENV must be production");
}

if (process.env.SHOPIFY_APP_URL !== "https://www.unoir.studio") {
    errors.push("SHOPIFY_APP_URL must be https://www.unoir.studio");
}

if (process.env.SCOPES !== "read_products,write_products") {
    errors.push("SCOPES must be read_products,write_products");
}

const opsShops = process.env.INTERNAL_OPS_SHOPS?.split(",").map((shop) => shop.trim()).filter(Boolean) ?? [];
if (opsShops.length === 0) {
    errors.push("INTERNAL_OPS_SHOPS must include at least one internal myshopify.com shop");
}
for (const shop of opsShops) {
    if (!shopDomainPattern.test(shop)) {
        errors.push(`INTERNAL_OPS_SHOPS contains an invalid shop domain: ${shop}`);
    }
}

if (!process.env.DATABASE_URL?.startsWith("postgresql://") && !process.env.DATABASE_URL?.startsWith("postgres://")) {
    errors.push("DATABASE_URL must be a Postgres connection string");
}

if (!process.env.REDIS_URL?.startsWith("rediss://")) {
    errors.push("REDIS_URL must use rediss:// TLS in production");
}

const storageEndpoint = process.env.STORAGE_ENDPOINT?.trim()
    || `https://${process.env.STORAGE_ACCOUNT_ID?.trim()}.r2.cloudflarestorage.com`;

for (const [key, value] of [
    ["SHOPIFY_APP_URL", process.env.SHOPIFY_APP_URL],
    ["STORAGE_ENDPOINT or derived STORAGE_ACCOUNT_ID endpoint", storageEndpoint],
    ["STORAGE_PUBLIC_BASE_URL", process.env.STORAGE_PUBLIC_BASE_URL],
]) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") {
            errors.push(`${key} must use https://`);
        }
    } catch {
        errors.push(`${key} must be a valid URL`);
    }
}

if (process.env.STORAGE_ACCOUNT_ID && !/^[a-z0-9]+$/i.test(process.env.STORAGE_ACCOUNT_ID.trim())) {
    errors.push("STORAGE_ACCOUNT_ID must be a Cloudflare account id without protocol or slashes");
}

for (const key of ["DATABASE_URL", "REDIS_URL"]) {
    try {
        const url = new URL(process.env[key]);
        if (placeholderFragmentPattern.test(url.href) || url.hostname === "replace_me") {
            errors.push(`${key} must point to a real production service`);
        }
    } catch {
        errors.push(`${key} must be a valid URL`);
    }
}

if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
}

console.log("Production environment looks ready.");
