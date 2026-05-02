# Security

Unoir Studio relies on Shopify Admin API access, remove.bg, Redis, and S3-compatible object storage. Treat every value in `.env` as a production secret unless it is clearly local-only.

## Secret Handling

- Do not commit `.env`, `.env.*`, database dumps, or copied chat transcripts that include credentials.
- Store production secrets in the deployment platform's secret manager.
- Use a scoped object-storage key that can read and write only the Unoir bucket.
- Rotate exposed credentials immediately. At minimum: `REMOVE_BG_API_KEY`, object-storage access keys (`STORAGE_ACCESS_KEY`/`STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_KEY`/`STORAGE_SECRET_ACCESS_KEY`), and any local/admin password shared outside the machine.

## Required Shopify Webhooks

The app must keep these webhook routes active for App Store and privacy review:

- `/webhooks/app/uninstalled`
- `/webhooks/customers/data_request`
- `/webhooks/customers/redact`
- `/webhooks/shop/redact`

The uninstall and shop-redact handlers delete job rows, image rows, and sessions for the shop. Stored image object cleanup runs afterward on a best-effort basis and logs failures for manual follow-up.
