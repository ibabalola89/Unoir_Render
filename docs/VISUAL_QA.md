# Unoir Studio — Visual QA

Use this pass after design-system changes and before final App Store screenshots. It is for visual inspection only; do not use seeded data as production evidence.

## Embedded Jobs Fixture

Seed representative Jobs states for the authenticated dev store:

```bash
npm run seed:visual-qa -- your-dev-store.myshopify.com
```

Then open Unoir Studio inside Shopify admin and inspect `/app/jobs`.

The fixture creates local-only jobs covering:

- Review-ready processed images.
- Published images with rollback affordance.
- Publish recovery with failed publish and retry affordance.
- Active processing/pending state.
- Recovered image metadata.

The script removes and recreates only jobs whose idempotency key starts with `visual-qa:` for the supplied shop.

## Preview Compare Fixture

To inspect preview compare cards with local processed images, start the app server with `STORAGE_PUBLIC_BASE_URL` pointing at the same app origin that serves `/public` assets. In Shopify app dev this is usually the current tunnel URL, not necessarily `localhost`.

```bash
STORAGE_PUBLIC_BASE_URL=https://your-current-dev-tunnel.example.com npm run dev
STORAGE_PUBLIC_BASE_URL=https://your-current-dev-tunnel.example.com npm run seed:visual-qa -- your-dev-store.myshopify.com --processed
```

Without `--processed`, Jobs dashboard QA still works and preview cards show the unprocessed state safely. With `--processed`, the app resolves fake `processedKey` values through `STORAGE_PUBLIC_BASE_URL`, so the app server and seed command must agree on the same origin.

Use this only in local/dev. Do not publish seeded fixture images to Shopify.

## Inspection Checklist

- Jobs cards scan by thumbnail first, not metadata first.
- Failure and recovery states are visible without overpowering healthy jobs.
- Created/completed timestamps stay subordinate to operational counts.
- Retry, review, publish, and rollback actions align predictably across card states.
- Narrow embedded widths preserve chip/action wrapping without overlap.
- Review cards show Inter UI, stable compare frames, clear approve/reject/reprocess controls, and preserved-original messaging.
- Public pages still use Canela display typography after licensed assets are installed; embedded product UI remains Inter.