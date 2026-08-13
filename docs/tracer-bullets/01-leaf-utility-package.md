# Tracer PR: Extract a Leaf Utility Package

Status: proposal only

## Question

Can Say To Me adopt workspace packages without making development, builds, or tests
slower or more complicated?

This tracer tests the smallest useful monorepo seam: a side-effect-free package used by
both browser and server code. It does not test product-domain ownership.

## Hypothesis

A narrow leaf package can provide:

- explicit public exports instead of cross-tree relative imports;
- package-local tests and type checking;
- faster ownership and dependency reasoning;
- no measurable regression in root commands or test duration.

If even this package needs root aliases, source-directory exceptions, or duplicated
configuration, the repository is not ready for larger package moves.

## Proposed Package

Create `packages/runtime-validation` as `@say-to-me/runtime-validation`.

Move the runtime-safe JSON parsing boundary and its focused tests into the package. The
package may depend on ArkType, but must not depend on React, Node-only APIs, SQLite,
provider SDKs, or application runtime modules.

This is intentionally not named `utils`. The package owns one coherent capability:
turning untrusted JSON and HTTP response bodies into validated values.

## Scope

- Add root npm workspaces configuration and the minimum Vite+ task configuration needed
  for one package.
- Add a private package with explicit `exports` and package-local TypeScript settings.
- Move `safe-json-parse.ts` and its tests into the package.
- Update browser and server consumers to import the package public API.
- Preserve the existing root commands: `vp check`, `vp test`, and `vp build`.
- Document the dependency rule: this package cannot import application code.

## Non-goals

- Do not move `src`, `server`, build entrypoints, database code, or provider code.
- Do not create a generic shared package or move unrelated helpers.
- Do not publish to npm.
- Do not redesign schemas or change validation behavior.
- Do not add path aliases as a substitute for package exports.

## Expected PR Shape

The PR should be mostly moves and import updates. Semantic changes should be limited to
package boundaries and configuration.

Expected areas:

- root `package.json` and lockfile;
- root Vite+ and TypeScript configuration;
- `packages/runtime-validation/package.json`;
- package source and tests;
- imports in existing browser and server consumers.

## Validation

Record a baseline from the same machine before editing, then report:

- clean install duration;
- `vp check`, `vp test`, and `vp build` duration;
- package-only test duration;
- production bundle size;
- number of package consumers in browser and server code;
- any root-only configuration the package still requires.

Run the full suite at least 3 times after a warm-up. Use the median.

## Success Criteria

- All existing behavior and tests remain intact.
- Root commands remain the only commands required for normal contributors.
- Package-only tests run without loading React, SQLite, `server/api.ts`, or provider SDKs.
- No circular dependency from the package back to the application.
- Full test and build medians regress by no more than 5 percent.
- The package public API is smaller than its internal file set and uses explicit exports.
- Moving another leaf capability would require repeating a documented pattern, not
  inventing new tooling.

## Failure Signals

- Workspace setup causes lockfile churn that cannot be explained or reproduced.
- Consumers still need relative imports into package internals.
- Package tests transitively load application runtime modules.
- Root and package TypeScript settings diverge substantially.
- The package becomes a miscellaneous dumping ground during the PR.
- Build or test duration regresses by more than 5 percent without a clear fix.

## Decision Enabled

If successful, adopt leaf packages for contracts, runtime validation, and test support.
It does not prove that a vertical service or deployable app should become a package.

If unsuccessful, keep leaf modules in the current tree and improve import boundaries
before attempting a larger monorepo split.
