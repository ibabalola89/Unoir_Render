# Unoir Studio — Built for Shopify Readiness

Built for Shopify is a product-quality bar, not a feature checklist. For Unoir Studio, the path is merchant trust, operational safety, speed, accessibility, and predictable Shopify-native workflows.

See [ROADMAP.md](ROADMAP.md) for the current launch sequence. Production infrastructure comes before this polish phase.

## Current Direction

Unoir is already aligned with the quality model Shopify describes for high-trust apps:

- Embedded Shopify workflow, not an external editor.
- Review before publishing.
- Originals preserved.
- Rollback available on every plan.
- Quota exhaustion blocks only new processing, not review, publish, rollback, history, or Jobs.
- No surprise overages.
- Async jobs, retries, recovery, health checks, and telemetry.
- Curated finishes, not generic presets, themes, templates, or AI prompt tooling.

## Launch Priority Order

1. Performance audit
2. Accessibility audit
3. Error-state polish
4. Production reliability testing
5. Mobile responsiveness pass
6. Shopify review checklist prep

Do not prioritize new finishes, new pricing tiers, extra AI providers, or settings panels ahead of these.

## Performance Discipline

Target feeling: calm and fast.

Audit:

- Initial embedded app load and route transitions.
- Product picker load state, empty state, and pagination behavior.
- Preview route image loading and compare slider responsiveness.
- Jobs dashboard refresh and status rendering.
- Queue responsiveness from Process to Preview.
- Bundle weight from Polaris, App Bridge, compare slider, and app routes.

Acceptance checks:

- App Bridge is current enough for Shopify admin Web Vitals collection and is scoped to embedded `/app` routes only.
- Largest above-the-fold UI has a useful skeleton or loading state.
- Preview images specify stable layout dimensions to avoid shifting.
- Processing and publishing actions return quickly and move long work into the queue.
- The app never blocks review/publish/rollback surfaces because remove.bg or Redis is briefly unhealthy.

## Accessibility

Target feeling: Shopify-native and usable without precision pointing.

Audit:

- Keyboard navigation through picker, finish selection, review actions, compare control, publish choices, Jobs actions, billing actions.
- Visible focus states on every interactive control.
- Color contrast for premium dark surfaces, status pills, disabled actions, warning/error banners, and finish cards.
- ARIA labels or text alternatives for compare slider and icon-only controls.
- Screen reader order on review and publish flows.

Acceptance checks:

- A merchant can process, review, approve/reject, publish, and roll back without a mouse.
- Compare functionality has an accessible fallback or clear accessible labeling.
- Error banners announce what happened and the safest next action.
- Mobile viewport has no horizontal overflow in core flows.

## Error-State Polish

Target feeling: clear, recoverable, and merchant-safe.

Every failure state should answer:

- What happened?
- Did anything change in Shopify?
- What can the merchant safely do next?

Required states:

- Queue unavailable.
- Worker offline.
- remove.bg outage or insufficient credits.
- Storage/CDN unavailable.
- Quota exhausted.
- Processing timeout.
- Publish failure.
- Rollback failure.
- Billing plan inactive or trial state unclear.

Copy rules:

- Use merchant language, not stack traces.
- Prefer “Nothing was published” or “Originals are preserved” where true.
- Keep review, publish, rollback, Jobs, and history reachable when quota is exhausted.
- Never imply automatic overage billing.

## Shopify-Native UX

Target feeling: Shopify extended itself.

Keep:

- Polaris components for admin workflows.
- App Bridge embedded navigation expectations inside the authenticated `/app` shell.
- Shopify Billing API for plan changes.
- Shopify-native terminology around products, media, jobs, publishing, and rollback.

Avoid:

- AI-first vocabulary.
- “Background preset,” “template,” or “theme” for finishes.
- Decorative editor UI that competes with Shopify admin.
- Automatic catalog changes without explicit review.

## Billing Clarity

Target feeling: no surprises.

Acceptance checks:

- Free: $0, 20 premium exports/month, White + Transparent.
- Starter: $79.99/month, 500 premium exports/month, 7-day trial, all editorial finishes.
- No Growth or Pro tier in V1.
- No automatic overage billing.
- Quota exhaustion only prevents new processing.
- Trial and plan status are visible before a merchant commits to processing work that requires Starter.

## Operational Reliability

Target feeling: boring in the best way.

Acceptance checks:

- `/healthz` is shallow enough for platform liveness.
- `/health` reports DB, Redis, storage, remove.bg, and worker status.
- `/health?cdn=1` verifies public CDN object serving for Shopify media ingest readiness.
- `npm run check:production-smoke` verifies public health, CDN, privacy, and support routes before the interactive smoke pass.
- Operations dashboard runs the public CDN write/read probe only when opened as `/app/ops?cdn=1`.
- Operations dashboard is hidden and route-gated to shops listed in `INTERNAL_OPS_SHOPS`.
- Production env validation rejects placeholders and malformed service URLs.
- Worker can recover stalled processing jobs.
- Publish path is idempotent enough to avoid duplicate unsafe state after retries.
- Rollback preserves original media and only removes Unoir-published media.
- Telemetry captures queue, provider, publish, rollback, and recovery failures.

## Documentation And Support

Before App Store submission, prepare:

- Privacy policy that explains merchant image processing and storage. Current public route: `/privacy`.
- Support email and expected response window. Current public route: `/support`; inbox target: `support@unoir.studio`.
- Demo store review instructions.
- Submission evidence packet with production smoke output, screenshots, rollback proof, reviewer access notes, and Partner Dashboard settings.
- Clear uninstall behavior and data deletion behavior.
- Billing and trial explanation matching the app listing.
- Support-ready troubleshooting notes for processing, publishing, quota, and rollback.

Track these in [SUPPORT_PRIVACY.md](SUPPORT_PRIVACY.md).

## Hero And Brand Direction

The landing page should optimize for trust and clarity. Keep White as the hero default because it communicates cleaned, standardized, studio-ready commerce imagery fastest.

Use secondary showcase moments later for Atelier, Noir, and Porcelain. Do not make Transparent, Stone, or Noir-only the default landing visualization.

Typography split:

- Marketing/editorial surfaces use Canela for hero headlines and major brand statements.
- Embedded product UI uses Inter for buttons, metadata, forms, jobs, picker, billing, and review flow.
- Run `npm run check:brand-assets` before final screenshots to confirm licensed Canela webfont files are present.

## Next Audit Passes

Run these before production submission:

1. Performance pass across first-run home, product picker, processing, preview, publish, Jobs, and billing.
2. Accessibility pass across keyboard, focus, contrast, ARIA, screen reader order, and mobile overflow.
3. Error-state pass by forcing queue, worker, remove.bg, storage, quota, billing, publish, and rollback failures.
4. Production reliability pass against Render, Postgres, TLS Redis, Cloudflare R2, CDN public URL, Shopify OAuth, billing, and webhooks using [PRODUCTION_SMOKE_TEST.md](PRODUCTION_SMOKE_TEST.md).
5. App Store review prep against listing copy, screenshots, demo instructions, privacy/support pages, and Partner Dashboard settings.