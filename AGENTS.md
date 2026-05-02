# Unoir Studio — Agent Instructions

## Project
Shopify embedded app that standardizes product imagery via remove.bg, previews results, and publishes back to Shopify.

## The Only Loop That Matters
Install → Select → Process → Preview → Publish

## Hardcoded V1 Constraints (do NOT make configurable)
- Finish output: fixed curated set only — White, Porcelain, Stone, Atelier, Noir, Transparent
- AI provider: remove.bg
- Image formats: JPG + PNG
- Max 50 images per job
- Tiers: Free ($0, 20 premium exports/month, White + Transparent) and Starter ($79.99/mo, 500 premium exports/month, 7-day trial, all editorial finishes) only
- Workflow trust features are not gated: review-before-publish, originals preserved, rollback, compare flow, and Jobs dashboard stay available on Free and Starter
- Quota exhaustion hard-caps new processing only; never lock review, publish, rollback, Jobs dashboard, or history
- No automatic overage billing or surprise charges in V1

## Stack
- Remix + TypeScript (Shopify app template)
- Shopify App Bridge + Polaris
- Prisma (SQLite dev / Postgres prod) for sessions + jobs
- BullMQ + Redis for async processing
- remove.bg API
- S3-compatible CDN storage

## Folder Structure (flat, no monorepo)
```
/app/routes        - Remix routes
/app/components    - React components
/app/hooks         - React hooks
/lib/shopify       - GraphQL clients, admin API helpers
/lib/ai            - remove.bg client
/lib/queue         - BullMQ workers + queue config
/lib/storage       - CDN upload/download
/lib/billing       - Shopify Billing API
/prisma            - schema + migrations
/public            - static assets
```
Extract packages only when seams appear.

## Implementation Discipline
- No preset/settings system. No custom backgrounds. No second AI provider. No Growth/Pro tiers.
- No premature abstractions or settings panels.
- Trust feature = rollback. Don't cut corners on Phase 5.
- Every fix must preserve a unified source of truth: use the existing canonical module, constant, route loader/action, Prisma state, or shared component style instead of duplicating business meaning.
- Every fix that touches workflow state must preserve idempotency: double-submit, refresh, retry, worker restart, and partial failure should reuse, claim, verify, or no-op safely.
- In handoff notes, include a short "Unified source" and "Idempotency" note for the change. If the change is presentation-only, say that it does not affect state transitions.

## Definition of Done (MVP)
Merchant installs → selects 20 images → standardizes them with an included finish → previews → publishes, all inside Shopify admin.

See [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md) for full scope.
