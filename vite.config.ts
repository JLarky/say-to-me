import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";

const isVitest = process.env.VITEST === "true";

function stylexPlugin() {
  const plugin = stylex.vite({ useCSSLayers: true });
  if (!isVitest) return plugin;
  return {
    ...plugin,
    configureServer: undefined,
    handleHotUpdate: undefined,
    transformIndexHtml: undefined,
  };
}

const safeJsonParseMessage =
  "Use safeJsonParse(schema, raw) or parseJson(schema, raw) from src/safe-json-parse.ts with an ArkType schema instead of JSON.parse.";

const safeResponseJsonMessage =
  "Use safeResponseJson(response, schema) from src/safe-json-parse.ts with an ArkType schema instead of response.json().";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      ".agent/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".gemini/**",
      ".opencode/**",
      ".pi/**",
      ".roo/**",
      ".windsurf/**",
      "tools/oxlint/anti-slop/**",
    ],
  },
  // Lint rules live here (formerly oxlint.config.ts). Vite+ `vp check` / CI use this block.
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: [
      ".agent/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".gemini/**",
      ".opencode/**",
      ".pi/**",
      ".roo/**",
      ".windsurf/**",
      "tools/oxlint/anti-slop/**",
    ],
    jsPlugins: [
      "@stylexjs/eslint-plugin",
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    ],
    rules: {
      "@stylexjs/no-unused": "error",
      "@stylexjs/valid-styles": "error",
      "@stylexjs/valid-shorthands": "error",
      // Worker scripts run through Node's strip-only type stripping, which rejects
      // parameter properties at import time. One in a shared module takes down every
      // worker whose import graph reaches it. Assign in the constructor body instead.
      "typescript/parameter-properties": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "JSON",
          property: "parse",
          message: safeJsonParseMessage,
        },
      ],
      "anti-slop/no-chained-type-assertions": "warn",
      "anti-slop/no-conditional-empty-object-spread": "warn",
      "anti-slop/no-known-value-widening": "warn",
      "anti-slop/no-module-mocking": "warn",
      "anti-slop/no-object-parameters": "warn",
      "anti-slop/no-reflect-apply": "warn",
      "anti-slop/no-reflect-get": "warn",
      "anti-slop/no-runtime-typeof": "warn",
      "anti-slop/no-shape-in-symbol-names": "warn",
      "anti-slop/no-unknown-parameters": "warn",
      "anti-slop/no-unknown-returns": "warn",
      "anti-slop/no-unknown-type-aliases": "warn",
      "anti-slop/no-unsafe-dictionary-type": "warn",
      "anti-slop/no-widen-then-assert": "warn",
      "anti-slop/require-safety-comment-for-type-assertion": "warn",
    },
    overrides: [
      {
        files: ["src/**/*.ts", "src/**/*.tsx"],
        rules: {
          "no-restricted-properties": [
            "error",
            {
              object: "JSON",
              property: "parse",
              message: safeJsonParseMessage,
            },
            {
              property: "json",
              message: safeResponseJsonMessage,
            },
          ],
        },
      },
      {
        files: ["**/*.test.ts", "**/*.suite.ts"],
        rules: {
          "no-restricted-properties": "off",
        },
      },
      {
        files: ["**/*.test.tsx", "**/*.suite.tsx"],
        rules: {
          "no-restricted-properties": "off",
        },
      },
      {
        files: ["server/external-cli/delivery-internal.ts"],
        rules: {
          "no-restricted-properties": "off",
        },
      },
      {
        files: ["packages/runtime-validation/src/safe-json-parse.ts"],
        rules: {
          "no-restricted-properties": "off",
        },
      },
    ],
  },
  test: {
    // shared-modules reuses the transformed server/UI graph. Leaf package
    // tests run alone (default isolate). A few files need a unique env graph.
    projects: [
      {
        extends: true,
        test: {
          name: "isolated-env",
          isolate: true,
          setupFiles: ["server/vitest-db-setup.ts"],
          include: [
            "server/api.opencode-activity-disabled.test.ts",
            "server/api.opencode-activity-enabled.test.ts",
            "server/external-cli/import-order-guard.test.ts",
            "server/vitest-owned-db.test.ts",
            "server/routines.opencode-enqueue.test.ts",
            "server/api-routes/spaces.test.ts",
            "server/api-routes/sse-routes.test.ts",
            "server/cursor/rest-delivery-worker.test.ts",
            "server/claude/rest-delivery-worker.test.ts",
            "server/codex/rest-delivery-worker.test.ts",
            "server/grok/rest-delivery-worker.test.ts",
            "server/external-cli/live-child.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          // Leaf packages: light graphs, no SQLite setup, Vitest default isolate.
          name: "packages",
          include: ["packages/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "shared-modules",
          isolate: false,
          setupFiles: ["server/vitest-db-setup.ts"],
          include: ["server/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: [
            "**/node_modules/**",
            "server/api.opencode-activity-disabled.test.ts",
            "server/api.opencode-activity-enabled.test.ts",
            "server/external-cli/import-order-guard.test.ts",
            "server/vitest-owned-db.test.ts",
            "server/routines.opencode-enqueue.test.ts",
            "server/api-routes/spaces.test.ts",
            "server/api-routes/sse-routes.test.ts",
            "server/cursor/rest-delivery-worker.test.ts",
            "server/claude/rest-delivery-worker.test.ts",
            "server/codex/rest-delivery-worker.test.ts",
            "server/grok/rest-delivery-worker.test.ts",
            "server/external-cli/live-child.test.ts",
          ],
        },
      },
    ],
  },
  run: {
    // Enable Vite Task output replay for `vp run <script>` (e.g. `vp run test`).
    // Root `test` runs each leaf package's `test` task (`vp run --filter
    // ./packages/*`), then shared-modules + isolated-env. Packages define a
    // cached `test` task in their vite.config (see packages/package-test-task.ts).
    // Bare `vp test` / `vp check` are uncached — CI and forced local re-runs.
    cache: {
      scripts: true,
      tasks: true,
    },
  },
  plugins: [stylexPlugin(), react()],
  server: {
    port: 3535,
    allowedHosts: process.env.SAY_TO_ME_TAILSCALE_HOST
      ? [process.env.SAY_TO_ME_TAILSCALE_HOST]
      : [],
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
