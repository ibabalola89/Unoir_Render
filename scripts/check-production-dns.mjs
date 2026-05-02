import dns from "node:dns/promises";

const appUrl = (process.env.PRODUCTION_SMOKE_APP_URL || process.env.SHOPIFY_APP_URL || "https://www.unoir.studio").trim().replace(/\/$/, "");
const cdnUrl = (process.env.PRODUCTION_SMOKE_CDN_URL || process.env.STORAGE_PUBLIC_BASE_URL || "https://cdn.unoir.studio").trim().replace(/\/$/, "");

const targets = [
    ["app", appUrl],
    ["public CDN", cdnUrl],
];
const errors = [];

for (const [label, targetUrl] of targets) {
    let hostname;
    try {
        const url = new URL(targetUrl);
        hostname = url.hostname;
        if (url.protocol !== "https:") {
            errors.push(`${label} URL must use https:// (${targetUrl})`);
            continue;
        }
    } catch {
        errors.push(`${label} URL must be valid (${targetUrl})`);
        continue;
    }

    const result = await resolveHost(hostname);
    if (!result.ok) {
        errors.push(`${label} DNS ${hostname}: ${result.error}`);
        continue;
    }

    console.log(`${label} DNS ${hostname}`);
    console.log(`  A: ${result.a.length > 0 ? result.a.join(", ") : "none"}`);
    console.log(`  AAAA: ${result.aaaa.length > 0 ? result.aaaa.join(", ") : "none"}`);
    console.log(`  CNAME: ${result.cname.length > 0 ? result.cname.join(", ") : "none"}`);
}

if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
}

console.log("Production DNS preflight passed.");

async function resolveHost(hostname) {
    const [a, aaaa, cname] = await Promise.allSettled([
        dns.resolve4(hostname),
        dns.resolve6(hostname),
        dns.resolveCname(hostname),
    ]);
    const records = {
        a: a.status === "fulfilled" ? a.value : [],
        aaaa: aaaa.status === "fulfilled" ? aaaa.value : [],
        cname: cname.status === "fulfilled" ? cname.value : [],
    };

    if (records.a.length > 0 || records.aaaa.length > 0 || records.cname.length > 0) {
        return { ok: true, ...records };
    }

    return {
        ok: false,
        error: [
            ["A", a],
            ["AAAA", aaaa],
            ["CNAME", cname],
        ]
            .map(([type, result]) => `${type}=${result.status === "rejected" ? result.reason?.code ?? result.reason?.message ?? String(result.reason) : "none"}`)
            .join(" "),
    };
}