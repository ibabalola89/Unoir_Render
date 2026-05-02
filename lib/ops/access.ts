const OPS_SHOPS_ENV = "INTERNAL_OPS_SHOPS";
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function isOpsShopAllowed(shop: string | null | undefined, env = process.env): boolean {
    if (!shop) return false;
    const allowlist = parseOpsShopAllowlist(env[OPS_SHOPS_ENV]);
    if (allowlist.invalid.length > 0) return false;
    const allowedShops = allowlist.shops;
    if (allowedShops.size === 0) return env.NODE_ENV !== "production";
    return allowedShops.has(shop.trim().toLowerCase());
}

export function parseOpsShopAllowlist(value: string | undefined): { shops: Set<string>; invalid: string[] } {
    const shops = new Set<string>();
    const invalid: string[] = [];
    for (const rawShop of (value ?? "").split(",")) {
        const shop = rawShop.trim().toLowerCase();
        if (!shop) continue;
        if (SHOP_DOMAIN_PATTERN.test(shop)) {
            shops.add(shop);
        } else {
            invalid.push(rawShop.trim());
        }
    }
    return { shops, invalid };
}

export function isValidOpsShopDomain(shop: string): boolean {
    return SHOP_DOMAIN_PATTERN.test(shop);
}
