# Unoir Studio — Production Smoke Test Runbook

Run this after production infrastructure is deployed, DNS is live, and before private beta.

The goal is to prove the full V1 loop on real services:

Install -> Select -> Process -> Preview -> Publish

Do not use this pass to add features or broaden scope. Record failures, fix launch blockers, and re-run the failed step plus any dependent steps.

## Required Setup

- Production app is deployed on Render with separate web and worker services.
- Production Postgres migration has run.
- Production Redis uses TLS.
- Production R2/S3-compatible bucket is configured.
- Object-storage credentials are present as either `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` or `STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY`.
- Object-storage endpoint is present as either `STORAGE_ENDPOINT` or Cloudflare `STORAGE_ACCOUNT_ID`.
- DNS for `www.unoir.studio` serves the app over HTTPS.
- DNS for `cdn.unoir.studio` publicly serves storage objects over HTTPS.
- DNS records follow [DNS_SETUP.md](DNS_SETUP.md).
- Shopify production app config is deployed.
- `INTERNAL_OPS_SHOPS` includes the internal test shop.
- `support@unoir.studio` is active or explicitly not part of this smoke pass.

## Preflight

Run these before installing the app:

```bash
npm run check:production-config
npm run check:production-env
npm run check:production-dns
npm run check:production-smoke
UNOIR_BASE_URL=https://www.unoir.studio npm run test:e2e:public
```

Run `check:production-env` inside the production service environment or with the exact production variables loaded. With services configured, DNS is the remaining gate before `check:production-smoke` can prove the public app and CDN paths. Run `check:production-dns` and `check:production-smoke` from any machine that can reach public DNS; override targets with `PRODUCTION_SMOKE_APP_URL=https://www.unoir.studio` or `PRODUCTION_SMOKE_CDN_URL=https://cdn.unoir.studio` if needed.

Then verify production endpoints:

- `https://www.unoir.studio/healthz` returns OK.
- `https://www.unoir.studio/health` returns OK for DB, Redis, storage, remove.bg, and worker.
- `https://www.unoir.studio/health?cdn=1` returns OK for public CDN object serving.
- `/`, `/privacy`, and `/support` render publicly without loading Shopify App Bridge.
- `/auth/login` redirects to `/` in production instead of showing the local development shop-domain form.
- From the internal shop, `/app/ops` loads and `/app/ops?cdn=1` shows Public CDN as connected.
- From a non-internal shop, `/app/ops` is not visible in navigation and direct access returns 404.

## Evidence To Capture

For each run, record:

- Date and tester.
- Test shop domain.
- App deployment/version identifier from Render.
- Worker deployment/version identifier from Render.
- Starting `/app/ops` queue counts and failure counts.
- Final `/app/ops` queue counts and failure counts.
- Job IDs used in the run.
- Screenshots for install, picker, preview, publish success, rollback success, billing, quota exhaustion, and any failure state.

## Core Loop

| Step | Action | Expected result | Evidence |
| --- | --- | --- | --- |
| 1 | Install from Shopify-owned surface | OAuth completes and app opens embedded in Shopify admin | Screenshot |
| 2 | Open Home | Plan, usage, and main workflow entry are visible | Screenshot |
| 3 | Open Select images | Products and eligible product images load | Screenshot |
| 4 | Select up to 20 images | Selection count and finish controls stay stable | Screenshot |
| 5 | Start processing | One job is created; merchant lands on job status/preview path | Job ID |
| 6 | Watch worker process | Queue active/waiting counts move and return to normal | Ops before/after |
| 7 | Review preview | Originals and processed images are visible with compare flow | Screenshot |
| 8 | Approve/reject images | Decisions persist after refresh | Screenshot |
| 9 | Publish approved images | Shopify media is created only for approved images | Product admin evidence |
| 10 | Roll back | Unoir-published media is removed and originals remain | Screenshot |

## Reliability Cases

Run these after one clean core-loop pass.

| Case | Action | Expected result |
| --- | --- | --- |
| Duplicate process | Double-click Process or replay the same form submit | Redirects to the first job; quota does not double-count |
| Retry failed | Click Retry Failed twice quickly | Only rows claimed by the first retry enqueue |
| Reprocess | Click Reprocess twice quickly on one image | Only one queue job is created |
| Publish refresh | Refresh during publish, then publish again | Existing publishing rows verify instead of creating duplicate media |
| Publish partial failure | Force one Shopify media ingest failure, then retry | Successful rows are not duplicated; failed rows retry |
| Rollback duplicate | Click Roll Back twice quickly | One rollback claims the job; second submit sees in-progress/completed state |
| Worker restart | Restart worker while processing | Recovery re-enqueues stale rows without duplicate quota usage |
| Cancel while active | Cancel a processing job while worker is active | Canceled rows do not continue visibly or publish |
| Billing duplicate | Open Starter checkout twice | Active subscription resolves without duplicate plan state |

## Failure-State Cases

Force these only on a test shop and reset services afterward.

| Failure | How to force | Expected merchant-facing behavior |
| --- | --- | --- |
| Worker offline | Stop worker service | New processing is blocked; review/publish/rollback/history remain reachable |
| Redis unavailable | Temporarily point worker/web to invalid Redis in a disposable deploy | New processing is blocked; existing review surfaces remain usable |
| remove.bg unavailable | Use an invalid remove.bg key in a disposable deploy | New processing is blocked with image-processing unavailable feedback; nothing is processed or published |
| Storage unavailable | Use invalid storage credentials in a disposable deploy | New processing/publish paths fail safely; originals remain preserved |
| CDN unavailable | Break `STORAGE_PUBLIC_BASE_URL` in a disposable deploy | `/health?cdn=1` fails; publish smoke is blocked |
| Quota exhausted | Use a Free shop with 20 images already used | New processing is blocked; Jobs, review, compare, publish, rollback, and history remain reachable |

## Stop Conditions

Stop the smoke pass and fix before private beta if any of these happen:

- Publishing changes Shopify without prior review/approval.
- Originals are deleted or made unavailable.
- Rollback removes merchant-owned original media.
- Quota exhaustion blocks review, publish, rollback, Jobs, or history.
- Duplicate submits create duplicate jobs, duplicate quota usage, or duplicate Shopify media.
- `/health` reports production dependencies healthy while the core loop cannot process.
- `/app/ops` is visible or reachable for non-internal shops.
- Billing copy, trial, price, or quota differs from Free/Starter V1 constraints.

## Completion Criteria

The production smoke pass is complete when:

- One clean core-loop run passes end to end.
- Reliability cases pass or have documented, accepted residual risk.
- Failure-state cases show recoverable merchant-facing behavior.
- `/app/ops` before/after counts match the observed jobs and failures.
- No stop condition remains open.
- Any residual risk is copied into the private beta notes before inviting merchants.
