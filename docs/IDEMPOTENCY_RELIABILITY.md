# Unoir Studio — Idempotency And Reliability

This checklist protects the core loop from duplicate submits, retries, refreshes, worker restarts, and partial failures.

## Fix Standard

Every fix should preserve two practices before it is considered complete:

1. Unified source implementation: choose one canonical source for each rule, value, status, quota, plan, finish option, copy pattern, or workflow state. Route code may format data for the UI, but it should not fork business meaning from shared modules, Prisma state, or established component styles. If a screen needs the same state twice, compute it once and render from that value.
2. Idempotency practice: any fix touching processing, review, publish, rollback, billing, queueing, storage, or quota behavior must describe what happens on double-submit, refresh, retry, worker restart, and partial failure. Repeated actions should either reuse the first result, claim rows before work, verify existing in-flight state, or no-op safely.

When reporting a fix, include a short note for both:

- Unified source: where the canonical rule/state now lives.
- Idempotency: why retrying or repeating the action remains safe, or why the change is presentation-only and does not affect state transitions.

## Current Guarantees

- Processing creates one `ProcessingJob` with deduped media IDs and transactionally re-checks quota and job rate limits.
- Process submits include a per-form idempotency key with a per-shop unique database guard, so browser retries or double-clicks reuse the first created job instead of creating duplicate jobs or double-counting quota.
- BullMQ processing jobs use deterministic `ProcessedImage.id` job IDs, preventing duplicate queue jobs for the same image.
- Retry claims failed image rows before enqueueing, so repeated Retry submits become no-ops for rows already claimed.
- Reprocess claims the image before enqueueing, so repeated Reprocess submits redirect safely instead of creating duplicate queue work.
- Approve/reject decisions are idempotent; applying the same decision again is a no-op.
- Publish claims the parent job before creating Shopify media and re-verifies existing `publishing` rows instead of creating duplicate media.
- Rollback claims the parent job before deleting Shopify media and reports complete versus partial results.
- Cancel marks pending/processing rows canceled; the worker re-checks DB state before doing work.
- Billing subscribe uses Shopify Billing `require`/`request`, so already-active Starter merchants are not sent through duplicate charge creation.

## Production Smoke Tests

Run these on production infrastructure before private beta as part of [PRODUCTION_SMOKE_TEST.md](PRODUCTION_SMOKE_TEST.md):

1. Double-click Process with the same selected images; the second submit should redirect to the first job and quota should not over-count.
2. Click Retry Failed twice quickly; only failed rows claimed by the first submit should enqueue.
3. Click Reprocess twice quickly on one image; only one queue job should be created.
4. Refresh during publish and click Publish again; existing `publishing` rows should verify rather than create duplicate Shopify media.
5. Force Shopify media ingest failure, then retry publish; failed rows should retry without duplicating successful published rows.
6. Click Roll Back twice quickly; only one rollback should claim the job, and the second should show in-progress feedback.
7. Restart the worker during processing; recovery should re-enqueue stale rows without duplicate credits.
8. Cancel a processing job while a worker is active; canceled rows should not publish or continue processing visibly.
9. Open Starter checkout twice; an active subscription should resolve through Shopify Billing without duplicate plan state.
10. From an internal shop listed in `INTERNAL_OPS_SHOPS`, re-run `/app/ops` after each failure test and confirm queue, failed jobs, recovery count, and publish failures match expectations.

## Remaining Hard-To-Prove Cases

- If Shopify `productCreateMedia` succeeds but the DB update fails before `publishedMediaId` is saved, a later publish retry cannot know which Shopify media was created. Production smoke testing should watch for this rare duplicate-media case.
- Public CDN readiness now depends on DNS being live; `/health?cdn=1` and `/app/ops?cdn=1` verify object serving through the configured `STORAGE_PUBLIC_BASE_URL` once the domain resolves.
