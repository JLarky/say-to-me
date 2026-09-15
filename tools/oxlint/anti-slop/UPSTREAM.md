# anti-slop provenance

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)

Revision: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (`main` at install time).

Production files under this directory are identical to `src/` at that commit, excluding the upstream RuleTester suites (`*.test.ts`). Those tests stay in the anti-slop repo; the install skill copies plugin source only.

## How it was installed

1. `npx skills add dmmulroy/anti-slop --skill install-anti-slop`
2. Copied skill assets with `rsync` to `tools/oxlint/anti-slop/` (the skill's `install.mjs` `cpSync` hit `EACCES` on this lima mount when creating nested `effect/shared`).
3. Installed matching Oxlint packages as exact versions: `oxlint@1.83.0` and `@oxlint/plugins@1.83.0`.

Skill lock: `skills-lock.json` → `install-anti-slop` hash `4031728fbe75bdcad6ee3208fd52b5d66e167b056fefee1fa9758e9a6cb9c0c8`.

Installed plugin path: `./tools/oxlint/anti-slop/index.ts`

## Intentional deviations

- Effect plugin is registered in `oxlint.config.ts` because the app depends on `effect` (Schema for env).
- Plugin tests were not vendored. That matches the skill asset bundle, not a local edit of rule source.
- Local rules `no-json-parse` and `no-broad-type-assertion` (plus `shared/json-method.ts`) are not upstream. `no-json-parse` forbids `JSON.parse` / `JSON['parse']`; JSON text is decoded with `decodeJsonText(text, Schema.Json)` and HTTP bodies with `decodeResponseJson`. `JSON.stringify` is allowed. `no-broad-type-assertion` forbids `as unknown`, `as object`, and `as any`. Preserve these on anti-slop updates.
