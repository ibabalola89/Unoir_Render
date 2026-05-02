# Unoir Studio — Support And Privacy Readiness

Public pages:

- `/privacy`
- `/support`

These pages are intended for App Store review, beta merchants, and public launch. Before submission, confirm `support@unoir.studio` is active and monitored.

## Privacy Commitments

- Unoir processes shop/session data, selected product media IDs, product IDs, source image URLs, alt text, original backups, processed outputs, job status, approvals, publish status, rollback metadata, plan, usage, and operational telemetry.
- Unoir does not require protected customer data in V1.
- Customer data request/redaction webhooks are configured and return without persisted customer records.
- App uninstall and shop redact webhooks call `deleteShopData(shop)`.
- Database records are deleted first; stored image object cleanup is best-effort afterward.

## Support Commitments

- Support email: `support@unoir.studio`.
- Beta response target: one business day.
- Public launch response target: two business days.
- Troubleshooting copy should reinforce: originals are preserved, publishing is review-gated, rollback removes Unoir-published media, quota exhaustion blocks only new processing, and no V1 overage billing exists.

## Submission Checks

- Run `npm run check:production-config` before `npm run deploy:production`.
- Run `npm run check:production-smoke` against the production domain after DNS is live; do not submit while `www.unoir.studio`, `/privacy`, `/support`, or `/health?cdn=1` are unreachable.
- Add `/privacy` as the Partner Dashboard privacy policy URL.
- Add `/support` or `support@unoir.studio` as the Partner Dashboard support contact.
- Verify production webhooks in `shopify.app.production.toml` are deployed.
- Confirm the privacy policy matches production storage/provider choices: remove.bg, Shopify APIs, Postgres, Redis, and S3-compatible object storage.
- Do not submit until the support inbox is live.
- Confirm the production landing page and `/auth/login` do not show the local-development shop-domain login form.
- Confirm reviewer demo products and screenshots contain no real merchant/customer data.