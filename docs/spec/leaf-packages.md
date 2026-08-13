# Leaf packages: extraction plan

## Purpose

Describe how and why we keep extracting application logic into workspace leaf
packages (`packages/*`, `@say-to-me/*`), and how that interacts with local
validation speed (`vp run test` / `vp run check`).

This is the standing plan after the runtime-validation tracer and the Effect /
durable-delivery peels. It is the default playbook for the next extractions —
not a one-off PR description.

## Goals

- **Shrink the unit under test.** Leaf packages run under the Vitest `packages`
  project with default isolate, no SQLite setup, and their own cached
  `vp run test` task. Unchanged packages stay cache hits when frontend or
  unrelated server code changes.
- **Keep typed Effect boundaries.** Workflow packages expose Effect programs +
  Layers with typed store/queue errors (`Effect.try` → domain error, not
  `Cause.Die`). App/server code wires Live layers to SQLite and HTTP.
- **Preserve simple day-to-day commands.** Contributors and agents still use:

  ```bash
  vp run check
  vp run test
  ```

  CI stays bare: `vp check && vp test` (full, no task-cache replay).

- **Grow the skippable bucket deliberately.** Packaging pays off when package
  tests live under `packages/**` and do not fan out through fat `server/*`
  re-exports.

## Non-goals

- Publishing packages to npm.
- Turning `src/` or `server/` into deployable multi-app monorepos.
- Moving React UI, Express/Astro/Elysia wiring, or Drizzle schema ownership into
  leaf packages (those stay app-side).
- Replacing Vitest `related` / `--changed` selection — packaging complements
  task cache; it does not replace file-level selection inside `shared-modules`.
- Per-package `check` scripts for every leaf (path-scoped `vp run check --
packages/<name>` already separates cache keys; revisit when packages are
  large).

## Current shape

| Package                            | Owns                                                 |
| ---------------------------------- | ---------------------------------------------------- |
| `@say-to-me/runtime-validation`    | ArkType-safe JSON / response parsing                 |
| `@say-to-me/session-utils`         | Pure session display / ordering / CLI resume helpers |
| `@say-to-me/provider-models`       | Sync CLI provider model list / current-model parsers |
| `@say-to-me/opencode-delivery`     | OpenCode durable-delivery workflow + Layers          |
| `@say-to-me/completion-watch`      | Completion-watch workflow + Layers                   |
| `@say-to-me/external-cli-delivery` | External-CLI durable-delivery workflow + Layers      |
| `@say-to-me/jarvis-timers`         | Jarvis timer workflow + Layers                       |

Root Vitest projects (see `vite.config.ts`):

| Project          | Role                                            |
| ---------------- | ----------------------------------------------- |
| `packages`       | `packages/**/*.test.ts` — leaf unit tests       |
| `shared-modules` | `server/**` + `src/**` peels (`isolate: false`) |
| `isolated-env`   | Few files that need a unique env graph          |

Root `package.json` `test` runs each leaf's cached `test` task
(`vp run --filter "./packages/*" test`), then `shared-modules` and
`isolated-env`. New leaves add `packages/<name>/vite.config.ts` via
`packageTestConfig` in `packages/package-test-task.ts`.

## What belongs in a leaf package

Extract when **most** of these hold:

1. **Pure or Effect-workflow core** — no imports of `server/db`, Express routes,
   React, or Astro.
2. **Stable public surface** — a small `exports` map (e.g. `./workflow`), not a
   barrel of app internals.
3. **Fast unit tests** — can be proven with in-memory fakes / Layers without a
   real SQLite file.
4. **Clear ownership** — one capability (timers, delivery, validation), not a
   grab-bag `utils` package.
5. **Callers stay thin** — app/server becomes glue: parse request, provide Live
   Layer, map errors to HTTP.

Prefer **peerDependency** on `effect` (and similarly for shared runtimes).
Concrete app deps (SQLite, SDKs) stay in the root app and Live layers.

## What stays in the app

- HTTP route modules and hosting adapters (`server/api-routes/*`, Astro/Elysia).
- Drizzle schema, migrations, and owned-DB test setup.
- React pages/components and StyleX.
- Real-DB peel / API regression tests that intentionally hit SQLite or the HTTP
  seam (`shared-modules` / `isolated-env`).
- Anything that must import both UI and server in one module.

## Extraction playbook (one capability / PR)

1. **Identify the core.** Prefer an existing Effect workflow + tests, or pure
   helpers with focused unit tests.
2. **Create the package.** Copy the jarvis-timers / completion-watch shape:
   - `packages/<name>/package.json` with `name`, `exports`, `peerDependencies`
   - `src/workflow.ts` (+ types/errors/Layers as needed)
   - `src/workflow.test.ts` (or sibling unit tests) under the `packages` project
   - `vite.config.ts` → `packageTestConfig("<name>")`
3. **Wire the app.** Root `package.json` dependency on `@say-to-me/<name>`;
   thin `server/*` re-export or direct imports from routes.
4. **Trim peels.** Keep real-DB / HTTP peels only where they add coverage the
   unit Layer tests cannot; do not duplicate happy paths in both places.
5. **Validate.**
   - `vp run test --filter @say-to-me/<name>` (or package path) stays small
   - Frontend-only edit: leaf tasks stay `◉ cache hit`
   - `vp run check && vp run test` green; CI still bare full suite
6. **Avoid import fan-out.** Do not re-export package APIs only through a fat
   `server/foo.ts` that half the suite imports — that makes `vp test related`
   pull dozens of peels. Prefer direct `@say-to-me/...` imports at call sites.

## Priority queue (next extractions)

Order is guideline; pick the next item when it unblocks a change or shrinks a
hot peel suite.

1. **More durable-delivery / watch cousins** still thick in `server/` (if any
   remain after external-cli / opencode / completion-watch).
2. **Pure session / Jarvis helpers** still living under `server/` or `src/` that
   already have unit-shaped tests (extend `@say-to-me/session-utils` or split a
   sibling when the export map gets crowded).
3. **Provider-agnostic Effect seams** (session router helpers, status parse)
   once Live vs test Layers are obvious and peels are mostly glue.
4. **Cmd+K / search pure rank-and-display helpers** (DB + route + React stay in
   app) if those helpers are already isolated.

Defer until boundaries are cleaner:

- Full OpenCode client wrapper packages (SDK versioning + network).
- Anything that must own SQLite schema.
- UI component libraries.

## Day-to-day usage (agents and humans)

| Moment                | Command                                           |
| --------------------- | ------------------------------------------------- |
| Default local loop    | `vp run check` · `vp run test`                    |
| Editing one leaf      | package `test` task misses; others hit            |
| Editing frontend only | leaf tasks hit; `shared-modules` may miss         |
| Tighter FE loop       | `vp test related <file> --project shared-modules` |
| Force full            | bare `vp check` / `vp test` (also CI)             |

Agents **must** prefer `vp run *` locally or they bypass task cache. See
`AGENTS.md`.

## Success criteria (ongoing)

- Each new leaf has package-local unit tests that do not load React, SQLite
  setup, or `server/api.ts`.
- No circular dependency from a package back into the app.
- Warm `vp run test` with an unchanged tree finishes in tens–hundreds of ms
  (full task-cache replay).
- Frontend-only changes do not re-execute leaf package test tasks.
- Extracting the next capability repeats this doc’s pattern without new
  toolchain inventions.

## Failure signals

- Package tests only pass when run inside `shared-modules` / with DB setup.
- Almost every change invalidates every package cache entry (hidden shared
  inputs, or identical commands across packages).
- Call sites keep importing through mega `server/*` modules so `related` fans
  out again.
- “Utils” packages accumulate unrelated exports.
- Contributors need more than `vp run check` / `vp run test` for routine work.

## Related docs

- `docs/tracer-bullets/01-leaf-utility-package.md` — original tracer hypothesis
- `docs/opencode-sdk.md` — Effect route / test pattern
- `docs/api-hosting-migration.md` — keep `*Effect` workflows for fast tests
- `AGENTS.md` — local vs CI task-cache habit
- https://viteplus.dev/guide/cache · https://viteplus.dev/guide/run
