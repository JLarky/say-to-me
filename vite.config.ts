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
  fmt: {},
  // Lint rules live here (formerly oxlint.config.ts). Vite+ `vp check` / CI use this block.
  lint: {
    options: { typeAware: true, typeCheck: true },
    jsPlugins: ["@stylexjs/eslint-plugin"],
    rules: {
      "@stylexjs/no-unused": "error",
      "@stylexjs/valid-styles": "error",
      "@stylexjs/valid-shorthands": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "JSON",
          property: "parse",
          message: safeJsonParseMessage,
        },
      ],
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
            "server/timers.opencode-enqueue.test.ts",
            "server/api-routes/spaces.test.ts",
            "server/api-routes/sse-routes.test.ts",
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
            "server/timers.opencode-enqueue.test.ts",
            "server/api-routes/spaces.test.ts",
            "server/api-routes/sse-routes.test.ts",
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
