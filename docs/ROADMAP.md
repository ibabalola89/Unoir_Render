# Unoir Studio — Launch Roadmap

The product now has enough V1 depth. The next work is not feature expansion; it is production operation, trust polish, and real merchant validation.

## Current Sequence

Proceed in this order:

1. Production deployment
2. Built for Shopify polish
3. Internal operations layer
4. Private beta merchants
5. App Store launch prep

## Phase 1 — Production Infrastructure

Do this now.

Finish:

- Render deployment.
- Postgres production database.
- TLS Redis.
- Cloudflare R2 production bucket.
- Cloudflare DNS. Current remaining production blocker; see [DNS_SETUP.md](DNS_SETUP.md).
- SSL.
- Production Shopify app config.
- Production environment variables.
- Public CDN base URL for Shopify media ingest.
- `npm run check:production-config` and `npm run check:production-env` passing in the production deploy path.
- `npm run check:production-smoke` passing against the production domain after DNS is live.

Then smoke test the full app on production infrastructure using [PRODUCTION_SMOKE_TEST.md](PRODUCTION_SMOKE_TEST.md).

Use [IDEMPOTENCY_RELIABILITY.md](IDEMPOTENCY_RELIABILITY.md) during smoke testing for duplicate-submit, retry, refresh, worker restart, and partial-failure scenarios.

### Production Smoke Test Checklist

- Install app.
- OAuth.
- Select images.
- Process queue.
- Recovery test.
- Review flow.
- Publish.
- Rollback.
- Reprocess.
- Billing trial.
- Quota exhaustion.
- Worker restart recovery.
- remove.bg failure handling.
- Public CDN object serving via `/health?cdn=1` or `/app/ops?cdn=1`.
- Idempotency checks for process, retry, publish, rollback, reprocess, and billing actions.

This is the most important engineering work right now. Until Unoir survives real production infrastructure reliably, everything else is secondary.

## Phase 2 — Built For Shopify Readiness

Start immediately after production infrastructure stabilizes.

Priority work:

- Performance pass: route speed, embedded loading, image rendering, compare interaction, queue responsiveness.
- Idempotency/reliability pass: repeated submits, retries, refreshes, worker restarts, and partial failures should not duplicate work or corrupt state.
- Accessibility pass: keyboard navigation, focus states, ARIA labels, color contrast, screen reader flow.
- Error-state polish: calm, recoverable states that reinforce that originals stay preserved.
- Mobile responsiveness: clean layouts, stable interactions, responsive compare flow, no broken overflow.

Goal: calm, fast, recoverable, Shopify-native.

## Phase 3 — Internal Operations Layer

Telemetry exists. Surface it before real merchant onboarding.

Build a small internal ops dashboard showing:

- Worker status.
- Queue depth.
- Failed jobs.
- Recovery count.
- Dependency health.
- Publish failures.

Restrict this dashboard to internal shops with `INTERNAL_OPS_SHOPS`; it should not appear in merchant navigation for normal installed stores.

This should be internal and operational, not a merchant-facing feature expansion.

## Phase 4 — Private Beta

Use private beta as the real product-learning phase.

Target 5-10 real stores.

Best-fit verticals:

- Beauty.
- Fashion.
- Luxury DTC.
- Sports.
- Premium brands.

Learn from:

- Real image edge cases.
- Real publish behavior.
- Real merchant psychology.
- Retention signals.
- Support questions.

## Phase 5 — App Store Assets

Create final App Store assets after beta feedback.

Prepare:

- Screenshots.
- Compare sequences.
- Finish showcase.
- Onboarding visuals.
- Trust messaging.
- Demo store instructions.
- Privacy/support materials. See [SUPPORT_PRIVACY.md](SUPPORT_PRIVACY.md).

The visual direction is set; this phase formalizes it.
The design token system now covers typography, spacing, radii, shadows, control sizing, fixed-format layout dimensions, and motion timing; future visual work should be micro-refinement rather than redesign.

## What Not To Do Now

Avoid:

- New features.
- Custom backgrounds.
- Prompts.
- Generation.
- Scene editing.
- Pricing complexity.
- Tier expansion.
- Additional AI providers.
- Settings panels.

Unoir is now in refinement and operational maturity, not feature expansion.

## Today’s Recommendation

Finish Render production deployment, then run [PRODUCTION_SMOKE_TEST.md](PRODUCTION_SMOKE_TEST.md).

The next challenge is not whether Unoir can be built. The next challenge is whether Unoir can be operated reliably for real merchants.