import type { MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";

import styles from "../styles/legal.module.css";

export const meta: MetaFunction = () => [
    { title: "Privacy Policy — Unoir Studio" },
    {
        name: "description",
        content: "How Unoir Studio handles Shopify product image processing data.",
    },
];

export default function PrivacyRoute() {
    return (
        <main className={styles.page}>
            <div className={styles.shell}>
                <nav className={styles.nav} aria-label="Policy navigation">
                    <Link to="/">Unoir Studio</Link>
                    <Link to="/support">Support</Link>
                </nav>

                <p className={styles.eyebrow}>Last updated May 1, 2026</p>
                <h1 className={styles.heading}>Privacy Policy</h1>
                <p className={styles.intro}>
                    Unoir Studio helps Shopify merchants make product images consistent. This policy explains what data the app uses, why it is needed, and how shop data is deleted.
                </p>

                <div className={styles.content}>
                    <section className={styles.section}>
                        <h2>Data We Process</h2>
                        <p>Unoir uses the minimum Shopify data needed for the image workflow:</p>
                        <ul>
                            <li>Shop domain, app session, plan, and usage information.</li>
                            <li>Product media IDs, product IDs, image source URLs, and image alt text for selected images.</li>
                            <li>Original image backups, processed image files, job status, approvals, publishing status, and rollback metadata.</li>
                            <li>Operational telemetry for queue, provider, storage, publish, rollback, and recovery failures.</li>
                        </ul>
                    </section>

                    <section className={styles.section}>
                        <h2>Customer Data</h2>
                        <p>
                            Unoir Studio is built for product imagery and does not need protected customer data for V1. Customer data request and redaction webhooks are configured, and the app does not store customer records.
                        </p>
                    </section>

                    <section className={styles.section}>
                        <h2>How Data Is Used</h2>
                        <ul>
                            <li>To let merchants select product images, apply curated finishes, review results, and publish approved media.</li>
                            <li>To preserve originals and support rollback of Unoir-published media.</li>
                            <li>To enforce monthly image capacity without surprise overage billing.</li>
                            <li>To monitor reliability and troubleshoot processing, publishing, billing, and rollback issues.</li>
                        </ul>
                    </section>

                    <section className={styles.section}>
                        <h2>Service Providers</h2>
                        <p>
                            Selected images are processed through remove.bg. Image backups and finished outputs are stored in S3-compatible object storage. Shopify APIs handle authentication, product media access, billing, publishing, webhooks, and app installation state.
                        </p>
                    </section>

                    <section className={styles.section}>
                        <h2>Retention And Deletion</h2>
                        <p>
                            Job and image data stays available while the app is installed so merchants can review history, publish approved images, and roll back media Unoir published. When the app is uninstalled or Shopify sends a shop redaction webhook, Unoir deletes shop sessions and job records. Stored image objects are then cleaned up on a best-effort basis.
                        </p>
                    </section>

                    <section className={styles.section}>
                        <h2>Security</h2>
                        <p>
                            Unoir uses Shopify authentication, scoped API access, server-side media validation, and production environment checks. If a required service is unavailable, new processing pauses until it recovers.
                        </p>
                    </section>

                    <section className={styles.section}>
                        <h2>Contact</h2>
                        <div className={styles.callout}>
                            <p>
                                For privacy or support questions, contact <a className={styles.inlineLink} href="mailto:support@unoir.studio">support@unoir.studio</a>.
                            </p>
                        </div>
                    </section>
                </div>
            </div>
        </main>
    );
}