import { readFileSync } from "node:fs";

const configPath = new URL("../shopify.app.production.toml", import.meta.url);
const config = readFileSync(configPath, "utf8");
const packagePath = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const rootPath = new URL("../app/root.tsx", import.meta.url);
const root = readFileSync(rootPath, "utf8");
const landingPath = new URL("../app/routes/_index/route.tsx", import.meta.url);
const landing = readFileSync(landingPath, "utf8");
const loginPath = new URL("../app/routes/auth.login/route.tsx", import.meta.url);
const login = readFileSync(loginPath, "utf8");
const privacyPath = new URL("../app/routes/privacy.tsx", import.meta.url);
const privacy = readFileSync(privacyPath, "utf8");
const supportPath = new URL("../app/routes/support.tsx", import.meta.url);
const support = readFileSync(supportPath, "utf8");
const billingPath = new URL("../app/routes/app.billing.subscribe.tsx", import.meta.url);
const billing = readFileSync(billingPath, "utf8");
const appShellPath = new URL("../app/routes/app.tsx", import.meta.url);
const appShell = readFileSync(appShellPath, "utf8");
const opsPath = new URL("../app/routes/app.ops.tsx", import.meta.url);
const ops = readFileSync(opsPath, "utf8");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireIncludes(content, needle, sourcePath, message) {
  if (!content.includes(needle)) {
    fail(`${message} (${sourcePath.pathname})`);
  }
}

const placeholder = "REPLACE_WITH_PRODUCTION_APP_URL";
if (config.includes(placeholder)) {
  fail(`Production app URL placeholder is still present in ${configPath.pathname}`);
}

const applicationUrl = config.match(/^application_url\s*=\s*"([^"]+)"/m)?.[1];
if (!applicationUrl?.startsWith("https://")) {
  fail("Production application_url must be a public https:// origin");
}

const requiredWebhookTopics = [
  "app/uninstalled",
  "customers/data_request",
  "customers/redact",
  "shop/redact",
];

const missingTopics = requiredWebhookTopics.filter((topic) => !config.includes(topic));
if (missingTopics.length > 0) {
  fail(`Production Shopify config missing webhook topics: ${missingTopics.join(", ")}`);
}

const scopes = config.match(/^scopes\s*=\s*"([^"]+)"/m)?.[1];
if (scopes !== "read_products,write_products") {
  fail(`Production Shopify scopes must stay minimal: read_products,write_products (got ${scopes ?? "missing"})`);
}

if (packageJson.dependencies?.["@shopify/app-bridge"]) {
  fail("Use app-bridge.js / @shopify/app-bridge-react, not legacy @shopify/app-bridge dependency");
}

if (packageJson.workspaces) {
  fail("Unoir V1 must stay a flat app; remove package.json workspaces before production deploy");
}

requireIncludes(
  root,
  'location.pathname.startsWith("/app")',
  rootPath,
  "Root document must scope Shopify app-bridge.js to embedded app routes",
);
requireIncludes(
  root,
  '<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />',
  rootPath,
  "Embedded app routes must load Shopify app-bridge.js",
);
const appBridgeIndex = root.indexOf("shopifycloud/app-bridge.js");
const remixScriptsIndex = root.indexOf("<Scripts />");
if (appBridgeIndex === -1 || remixScriptsIndex === -1 || appBridgeIndex > remixScriptsIndex) {
  fail(`Root document must load app-bridge.js before Remix Scripts (${rootPath.pathname})`);
}

requireIncludes(
  landing,
  'process.env.NODE_ENV !== "production"',
  landingPath,
  "Production landing page must hide the manual shop-domain login form",
);
requireIncludes(
  login,
  'if (process.env.NODE_ENV === "production") throw redirect("/");',
  loginPath,
  "Production /auth/login must redirect instead of showing a manual shop-domain form",
);
requireIncludes(privacy, "Privacy Policy", privacyPath, "Public privacy route must exist");
requireIncludes(privacy, "remove.bg", privacyPath, "Privacy policy must name the V1 image-processing provider");
requireIncludes(privacy, "preserve originals", privacyPath, "Privacy policy must describe preserved originals / rollback use");
requireIncludes(support, "support@unoir.studio", supportPath, "Public support route must expose support contact");
requireIncludes(support, "Unoir never publishes automatically", supportPath, "Support page must explain approval-gated publishing");
requireIncludes(support, "automatic overage billing", supportPath, "Support page must state there is no V1 overage billing");
requireIncludes(
  packageJson.scripts?.["test:e2e:public"] ?? "",
  "tests/e2e/public.spec.ts",
  packagePath,
  "Public Playwright smoke test must stay wired in package scripts",
);
requireIncludes(billing, "billing.require", billingPath, "Paid Starter plan must use Shopify Billing API");
requireIncludes(billing, "billing.request", billingPath, "Paid Starter plan must request Shopify Billing approval");
requireIncludes(appShell, "isOpsShopAllowed", appShellPath, "Operations nav must be hidden from non-internal shops");
requireIncludes(ops, "isOpsShopAllowed", opsPath, "Operations route must be internal-shop gated");
requireIncludes(ops, 'status: 404', opsPath, "Operations route should not expose internal diagnostics to non-internal shops");

console.log("Production Shopify/App Store config checks passed.");
