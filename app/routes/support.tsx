import type { MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";

import styles from "../styles/legal.module.css";

export const meta: MetaFunction = () => [
    { title: "Support — Unoir Studio" },
    {
        name: "description",
        content: "Support and troubleshooting for Unoir Studio merchants.",
    },
];

export default function SupportRoute() {
    return (
        <main className={styles.page}>
            <div className={styles.shell}>
                <nav className={styles.nav} aria-label="Support navigation">
                    <Link to="/">Unoir Studio</Link>
                    <Link to="/privacy">Privacy</Link>
                </nav>

                <p className={styles.eyebrow}>Merchant support</p>
                <h1 className={styles.heading}>Support</h1>
                <p className={styles.intro}>
                    Unoir Studio follows a clear workflow: select images, apply a finish, review results, publish approved media, and roll back media Unoir published when needed.
                </p>

                <div className={styles.content}>
                    <section className={styles.section}>
                        <h2>Contact</h2>
                        <div className={styles.callout}>
                            <p>
                                Email <a className={styles.inlineLink} href="mailto:support@unoir.studio">support@unoir.studio</a> for help.
                            </p>
                            <p>Expected response window: one business day for beta merchants and two business days after public launch.</p>
                        </div>
                    </section>

                    <section className={styles.section}>
                        <h2>Processing Issues</h2>
                        <ul>
                            <li>If processing is unavailable, new jobs pause until the image service recovers. Existing jobs remain available.</li>
                            <li>If a job fails, open the job and retry failed images. Retry does not use extra monthly capacity.</li>
                            <li>If monthly capacity is used, only new processing pauses. Existing jobs can still be reviewed, published, or rolled back.</li>
                        </ul>
                    </section>

                    <section className={styles.section}>
                        <h2>Publishing And Rollback</h2>
                        <ul>
                            <li>Unoir never publishes automatically. A merchant approves images before publishing.</li>
                            <li>Original Shopify product media stays in place. Rollback removes media Unoir published.</li>
                            <li>If publishing partially fails, reopen the job and publish again to retry failed or still-processing media.</li>
                        </ul>
                    </section>

                    <section className={styles.section}>
                        <h2>Billing</h2>
                        <ul>
                            <li>Free includes 20 images per month with White and Transparent finishes.</li>
                            <li>Starter is $79.99 per month, includes a 7-day trial, and includes 500 images per month plus all editorial finishes.</li>
                            <li>Unoir does not use automatic overage billing in V1.</li>
                        </ul>
                    </section>

                    <section className={styles.section}>
                        <h2>Uninstall And Data Deletion</h2>
                        <p>
                            When Unoir receives an app uninstall or shop redaction webhook from Shopify, shop sessions and job records are deleted. Stored image objects are cleaned up on a best-effort basis after database records are removed.
                        </p>
                        <p>
                            See the <Link className={styles.inlineLink} to="/privacy">Privacy Policy</Link> for more detail.
                        </p>
                    </section>
                </div>
            </div>
        </main>
    );
}