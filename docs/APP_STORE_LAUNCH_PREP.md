# Unoir Studio — App Store Launch Prep

## Positioning

Unoir Studio standardizes Shopify product imagery with curated catalog finishes, review-before-publish, preserved originals, and rollback.

See [ROADMAP.md](ROADMAP.md) for the current launch sequence. App Store assets come after production smoke testing, Built for Shopify polish, internal operations, and private beta feedback.

Use [SUPPORT_PRIVACY.md](SUPPORT_PRIVACY.md) before submission to verify public policy/support pages, support contact readiness, and data deletion behavior.

Use this language:

- Premium product imagery
- Catalog standardization
- Curated finishes
- Review before publishing
- Originals preserved
- Safe publishing
- Rollback
- Image capacity

Avoid this language:

- AI background remover
- Export/exporting when the action is processing or publishing back to Shopify
- Prompt, generation, creative editor, studio builder, Canva-style tooling
- Automated publishing or hands-off catalog changes

## Listing Copy Draft

### App Card Subtitle

Standardize product images before publishing.

### Short Value Proposition

Create consistent product imagery with curated finishes, compare every result, and publish only what you approve.

### App Introduction

Unoir Studio helps Shopify brands turn raw product photos into consistent catalog imagery without leaving the admin. Select eligible product images, choose a curated finish, process the set, review before publishing, and keep originals preserved for rollback.

### Feature List

- Standardize product images with White, Transparent, Porcelain, Stone, Atelier, and Noir finishes.
- Review every processed image before anything changes in Shopify.
- Preserve original product media and roll back Unoir-published images when needed.
- Process controlled catalog sets with monthly image capacity and no surprise overage billing.
- Track jobs, retries, failures, publishing, and rollback from a dedicated Jobs dashboard.

### Trust Copy

Originals are always preserved. Unoir never auto-overwrites your catalog; publishing happens only after review.

### Pricing Copy

Free includes 20 images per month with White and Transparent finishes. Starter includes 500 images per month, a 7-day trial, and all editorial finishes.

## Screenshot Plan

Shopify listing screenshots should be 1600 x 900, unique, focused on actual UI, and cropped without browser chrome or desktop backgrounds.

Before final screenshots, run `npm run check:brand-assets` and confirm licensed Canela webfont files are present. Marketing screenshots should show the Canela display stack, while product UI surfaces should remain Inter.

1. **First-run home**
   - Show the premium onboarding shell, usage panel, trust pill, and first-run guidance.
   - Caption/alt text: "First-run guide for safely standardizing product imagery."

2. **Select products**
   - Show product image selection, finish picker, and image capacity context.
   - Caption/alt text: "Select eligible product images and choose a curated finish."

3. **Finish showcase**
   - Show White, Transparent, Porcelain, Stone, Atelier, and Noir in the finish selector.
   - Caption/alt text: "Curated catalog finishes keep product imagery consistent."

4. **Review and compare**
   - Show before/after comparison and approve/reject controls.
   - Caption/alt text: "Compare each result before publishing changes to Shopify."

5. **Publish safely**
   - Show publish controls, append/use-as-primary choice, and preserved-original language.
   - Caption/alt text: "Publish approved images while preserving original media."

6. **Jobs and rollback**
   - Show Jobs dashboard with status, retry/review/publish/rollback affordances.
   - Caption/alt text: "Track jobs, retry failures, and roll back published images."

## Feature Image

Recommended size: 1600 x 900.

Direction: one focused UI composition that shows the review-before-publish moment. Use a real in-app screen or a polished crop of the compare flow. Do not submit a logo-only image.

Message on image, if any: "Review before publishing." Keep text minimal and high contrast.

## App Icon

Use [public/app-icon.png](../public/app-icon.png): 1200 x 1200 PNG, black background, white UN monogram.

Checklist:

- 1200 x 1200 px
- PNG or JPEG
- Square corners in source; Shopify clips automatically
- No Shopify marks
- Not a screenshot
- Enough padding for small sizes

## Demo Store and Review Instructions

The review demo should let Shopify reviewers complete the core loop:

1. Open Unoir Studio from the Shopify admin.
2. Select a small set of JPG or PNG product images.
3. Choose White or Transparent on Free, or an editorial finish on Starter.
4. Start processing and open the job.
5. Compare original and processed images.
6. Approve at least one image and reject at least one image.
7. Publish approved images.
8. Use rollback to remove Unoir-published media while leaving originals intact.

Include test credentials or access instructions in the Partner Dashboard submission. Keep demo products free of real merchant/customer data.

Review instructions should also say:

- Start from Shopify admin, not a direct public login form.
- Use demo products that include JPG or PNG product media.
- Free stores can complete the flow with White or Transparent.
- Starter stores can also test Porcelain, Stone, Atelier, and Noir.
- Publishing happens only after approval, and rollback removes only Unoir-published media.

## Submission Evidence Packet

Do not submit until these files or records are captured from production or the final demo store:

- Production smoke output from `npm run check:production-smoke` showing `/healthz`, `/health`, `/health?cdn=1`, `/privacy`, and `/support` passing.
- Brand asset check output from `npm run check:brand-assets` showing licensed Canela webfont files are present for final marketing screenshots.
- Screenshot of Home showing plan, usage, and the main workflow entry.
- Screenshot of Select images showing eligible JPG/PNG media, image capacity, and finish selection.
- Screenshot of Review and compare showing the compare control, approve/reject controls, and preserved-original messaging.
- Screenshot of Publish showing append/use-as-primary options and approval-gated publish state.
- Screenshot of Jobs showing retry/review/publish/rollback recovery actions.
- Screenshot or note proving rollback removed Unoir-published media while originals remained in Shopify.
- Partner Dashboard notes containing reviewer access instructions, support contact, privacy URL, emergency developer contact, and final billing copy.

Current blocker: production evidence cannot be complete until DNS resolves for `www.unoir.studio` and the public CDN domain, then `npm run check:production-smoke` passes against those live domains.

## Submission Checklist

- `npm run check:production-config` passes before deploying the production Shopify config.
- `npm run test:e2e:public` passes against the local or production app URL to confirm public launch pages and App Bridge scoping.
- `npm run check:brand-assets` passes before capturing final App Store screenshots.
- `npm run check:production-dns` passes after DNS records are created for the app and public CDN domains.
- `npm run check:production-smoke` passes against the production domain after DNS is live.
- App icon uploaded in Partner Dashboard.
- App name matches the listing and config: Unoir Studio.
- App listing avoids unsupported claims, guarantees, testimonials, reviews, and Shopify trademark misuse.
- Production landing page and `/auth/login` do not ask merchants to manually enter a `myshopify.com` domain; install starts from Shopify-owned surfaces.
- `app-bridge.js` is scoped to embedded `/app` routes and loads before Remix scripts there; public landing, privacy, support, and login pages do not load App Bridge.
- Screenshots are unique and show actual UI/features.
- Marketing screenshots use Canela for brand/editorial moments; embedded product UI remains Inter.
- Screenshots do not include browser chrome, desktop backgrounds, PII, pricing, ratings, or outcome guarantees.
- Demo store URL points reviewers directly to the best test flow.
- Compliance webhooks are configured for production.
- Emergency developer contact is configured in Partner Dashboard.
- Privacy policy URL points to `/privacy` on the production domain.
- Support contact points to `support@unoir.studio` or `/support` once the inbox is live.
- Billing copy matches Free and Starter plans exactly.
- Protected customer data requirements are reviewed; app should not need protected customer data for V1.
- No screenshots, demo data, or reviewer notes expose real merchant/customer data.

## Beta Validation Script

Use this script with real merchants before submission:

1. Ask merchant to select 5-10 real product images.
2. Watch whether they understand finish selection without explanation.
3. Observe the compare flow and whether approve/reject feels clear.
4. Ask whether they trust the publish step.
5. Ask whether preserved originals and rollback are obvious enough.
6. Review telemetry for queue failures, remove.bg failures, recovery triggers, publish failures, and rollback usage.
7. Capture support questions verbatim and update copy before adding features.

## Resources

- [Best practices for apps in the Shopify App Store](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices)
- [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
- [Submit your app for review](https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review)