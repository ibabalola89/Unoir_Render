/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "@remix-run/eslint-config/jest-testing-library",
    "prettier",
  ],
  globals: {
    shopify: "readonly"
  },
  // We use Vitest, not Jest. Pin the version so the bundled jest plugin
  // (pulled in by @remix-run/eslint-config) doesn't try to auto-detect a
  // missing Jest install.
  settings: {
    jest: { version: 29 },
  },
};
