# Unoir Studio — DNS Setup

Current blocker: public DNS for `unoir.studio` is not visible yet. `www.unoir.studio` and `cdn.unoir.studio` cannot pass production smoke until the root domain has live nameservers and the two production hostnames resolve.

## Required Records

Create these records in the authoritative DNS provider for `unoir.studio`:

| Host | Type | Target | Purpose |
| --- | --- | --- | --- |
| `www` | CNAME | Render custom-domain target for the web service | Production app origin |
| `cdn` | CNAME | Cloudflare R2/custom-domain target for the public bucket | Stable Shopify media ingest URLs |

Use the exact targets shown by Render and the object-storage/CDN provider. Do not point either record at localhost, a Shopify domain, or the Render dashboard URL.

## Required Env Alignment

Production env should match the DNS records:

```bash
SHOPIFY_APP_URL=https://www.unoir.studio
STORAGE_PUBLIC_BASE_URL=https://cdn.unoir.studio
```

For Cloudflare R2 storage credentials, either naming style is accepted:

```bash
STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
```

or:

```bash
STORAGE_ACCOUNT_ID=<account-id>
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
```

## Verification

After creating records, wait for propagation and run:

```bash
npm run check:production-dns
```

The command must show at least one `A`, `AAAA`, or `CNAME` result for both:

- `www.unoir.studio`
- `cdn.unoir.studio`

Then run:

```bash
npm run check:production-smoke
```

That moves the launch gate from DNS to real app and CDN health: `/healthz`, `/health`, `/health?cdn=1`, `/privacy`, and `/support`.

## Current Failure Shape

If DNS is not live, the expected failure is:

```text
app DNS www.unoir.studio: A=ENOTFOUND AAAA=ENOTFOUND CNAME=ENOTFOUND
public CDN DNS cdn.unoir.studio: A=ENOTFOUND AAAA=ENOTFOUND CNAME=ENOTFOUND
```

If the root domain also returns `ENOTFOUND` for nameserver/SOA lookups, fix registrar nameserver delegation or activate the DNS zone before debugging individual `www` and `cdn` records.