import {
  type LinksFunction,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "@remix-run/react";

import typographyStyles from "./styles/typography.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: typographyStyles },
];

export default function App() {
  const location = useLocation();
  const loadsEmbeddedAppBridge = location.pathname.startsWith("/app");

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/favicon-20.png" sizes="20x20" type="image/png" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        {loadsEmbeddedAppBridge ? (
          <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        ) : null}
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
