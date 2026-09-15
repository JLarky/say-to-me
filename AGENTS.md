# say-to-me2

Static checks go through Vite+: `vp check` (or `pnpm check`) formats, lints, and type-checks. Tests stay on Node's runner — `pnpm test` is `node --test "src/**/*.test.ts"`. Do not replace that with `vp test`.

## Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.
