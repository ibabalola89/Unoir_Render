export function shopFromAdminReferer(request: Request): string | null {
    const referer = request.headers.get("referer");
    if (!referer) return null;

    try {
        const url = new URL(referer);
        if (url.hostname !== "admin.shopify.com") return null;
        const match = url.pathname.match(/\/store\/([^/]+)/);
        const shop = match?.[1];
        if (!shop || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(shop)) return null;
        return `${shop.toLowerCase()}.myshopify.com`;
    } catch {
        return null;
    }
}

export function redirectToEmbeddedAppUrl(request: Request, path = "/app"): string | null {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || shopFromAdminReferer(request);
    if (!shop) return null;

    const target = new URL(path, url.origin);
    target.searchParams.set("shop", shop);
    return `${target.pathname}${target.search}`;
}