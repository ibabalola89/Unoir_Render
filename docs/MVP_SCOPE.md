# Unoir Studio — Refined MVP Scope

## The Only Loop That Matters

**Install → Select → Process → Preview → Publish**

Every phase either serves this loop or gets cut.

## Phase Structure

### Phase 1 — Foundation
Shopify OAuth, App Bridge, Polaris shell, session storage, webhook registration, Shopify Billing API connection (plumbing only — Free plan gate and 7-day Starter trial).

### Phase 2 — Product Media Engine
GraphQL product/image fetch, pagination, bulk selection, search/filter. Dashboard is functional, not decorative.

### Phase 3 — AI Processing Pipeline
remove.bg as primary provider. Async queue (BullMQ), job status, retry logic, CDN storage. One provider. Proven. Move on.

### Phase 4 — Preview & Approval
Side-by-side before/after. Approve or reject per image. Nothing else.

### Phase 5 — Publish & Rollback
Shopify media mutations. Original image backup. Rollback. Sync verification. This is the trust feature — don't rush it.

### Phase 6 — Billing
Shopify Billing API live. Free (20 premium exports, White + Transparent) and Starter ($79.99/mo, 500 premium exports, 7-day trial, all editorial finishes) tiers only. No Growth, no Pro until retention is proven.

## What Got Cut

| Removed                    | Reason                                                       |
| -------------------------- | ------------------------------------------------------------ |
| Preset system (Phase 4)    | Validate demand first. Ship the fixed curated set only, hardcoded. |
| Replicate / Photoroom      | One AI provider for V1. Swap if remove.bg fails.             |
| Monorepo package structure | Premature. Start flat.                                       |
| Growth + Pro tiers         | Price discovery happens after 10 paying merchants.           |

## Hardcoded for V1 (Not a Settings Panel)

- Finish output: fixed curated set only — White, Porcelain, Stone, Atelier, Noir, Transparent
- AI provider: remove.bg
- Image formats: JPG + PNG
- Processing: async, bulk-safe, max 50 images per job
- Pricing: Free ($0, 20 premium exports/month, White + Transparent) and Starter ($79.99/mo, 500 premium exports/month, 7-day trial, Porcelain + Stone + Atelier + Noir) only for V1
- Workflow access: review-before-publish, originals preserved, rollback, compare flow, and Jobs dashboard are available on both plans
- Quota exhaustion: hard cap new processing only; existing jobs, review, compare, publish, rollback, and Jobs dashboard remain available
- Overage billing: no automatic overages or surprise charges in V1

## KPIs

| KPI                             | Target                |
| ------------------------------- | --------------------- |
| Install → first processed image | < 3 min               |
| Bulk processing success rate    | > 95%                 |
| Shopify publish success         | > 99%                 |
| Processing time                 | < 15 sec/image        |
| Time to first paying merchant   | < 30 days post-launch |

## Folder Structure

```
/app
  /routes
  /components
  /hooks
/lib
  /shopify
  /ai
  /queue
  /storage
  /billing
/prisma
/public
```

Extract packages when the seams appear. Not before.

## Definition of Done for MVP

A merchant installs the app, selects 20 product images, standardizes them with an included finish, previews results, publishes back to Shopify — without leaving the Shopify admin. That's the bar. Everything else is post-launch.
