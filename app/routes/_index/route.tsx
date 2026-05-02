import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";

import { redirectToEmbeddedAppUrl } from "../../auth-context.server";
import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const embeddedTarget = redirectToEmbeddedAppUrl(request);
  if (embeddedTarget) throw redirect(embeddedTarget);

  return {
    showForm: Boolean(login) && process.env.NODE_ENV !== "production",
  };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Unoir Studio</p>
          <h1 className={styles.heading}>
            <span>Luxury product imagery,</span>
            <span>ready inside Shopify.</span>
          </h1>
          <p className={styles.text}>
            Give product photos a consistent finish, review every result, and
            publish approved images from Shopify admin.
          </p>
          <ul className={styles.list}>
            <li>Six curated finishes</li>
            <li>Review before publishing</li>
            <li>Original media stays intact</li>
          </ul>
        </section>

        <section className={styles.loginPanel} aria-label="Log in to Unoir Studio">
          <div className={styles.preview} aria-hidden="true">
            <div className={styles.previewImageWrap}>
              <img
                className={styles.beforeImage}
                src="/landing-product.svg"
                alt=""
              />
              <img
                className={styles.previewImage}
                src="/landing-product.svg"
                alt=""
              />
              <div className={styles.beforePane}>
                <span>Original</span>
              </div>
              <div className={styles.afterPane}>
                <span>Studio Ready</span>
              </div>
              <div className={styles.revealLine} />
            </div>
            <div className={styles.previewMeta}>
              <span>White finish</span>
              <strong>Review before publishing</strong>
            </div>
          </div>

          {showForm && (
            <Form className={styles.form} method="post" action="/auth/login">
              <label className={styles.label}>
                <span>Shop domain</span>
                <input
                  className={styles.input}
                  type="text"
                  name="shop"
                  placeholder="example.myshopify.com"
                  autoComplete="organization"
                />
              </label>
              <button className={styles.button} type="submit">
                Log in
              </button>
            </Form>
          )}
          {!showForm && (
            <div className={styles.installNotice}>
              <p>Install Unoir Studio from the Shopify App Store, then open it from Shopify admin.</p>
            </div>
          )}
          <nav className={styles.policyLinks} aria-label="Company links">
            <Link to="/privacy">Privacy</Link>
            <Link to="/support">Support</Link>
          </nav>
        </section>
      </div>
    </div>
  );
}
