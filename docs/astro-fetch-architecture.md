# Astro Fetch Architecture

Astro 7 uses `src/fetch.ts` as the single request entrypoint in development and
production. The file exports a Fetchable handler, so the same request pipeline is
used by `astro dev` and the Node standalone output.

## Request Ownership

`src/fetch.ts` wraps the Astro pipeline with Elysia:

1. `handleWebHostRequest` owns `/say` and `/api/*` by calling the shared Web
   `Request`/`Response` dispatch seam.
2. Elysia returns API responses, including structured JSON 404 responses for
   unknown API paths.
3. Requests that are not handled by the Web host continue to
   `astro(new FetchState(request))`, which owns page rendering and fallback.

There is no separate Vite API middleware or API catch-all route. This keeps page
and API behavior on one Astro-supported boundary in both environments.

## Dependencies

The root `package.json` must declare workspace packages used by the root request
graph, including `@say-to-me/runtime-validation` and `@say-to-me/session-utils`,
using the repository workspace version `0.1.0`. The root `.npmrc` must retain
`link-workspace-packages=true` so clean Nub installs create the same workspace
links as Vite Plus installs. Elysia also requires the root TypeBox peer
`@sinclair/typebox` at `^0.34.52`.

## Commands

```bash
rm -rf node_modules
nub i                 # or: vp i
vp run dev
vp run build:web
PORT=5415 vp exec node ./dist/server/entry.mjs
```

## Validation

Clean Nub and Vite Plus development runs both produced:

- `GET /api/otel-config`: `200` JSON, currently `{"enabled":false}`
- `GET /`: `200` HTML
- unknown `/api/*`: structured `404` JSON
- direct `src/fetch.ts` traversal, confirmed with a reversible request marker

The clean Nub `build:web` and standalone API/page smoke passed. The accepted
PR 591 validation also passed Vite Plus build and standalone smoke. A later
fresh merged-main Vite Plus follow-up was blocked while resolving `vite-plus`
from a workspace package config, so it did not reconfirm Vite Plus production.
The projects-type check issue was intermittent and was not reproduced in this
final documentation worktree: `vp run check` passed. These are toolchain
limitations, not request-routing behavior.

## Import Failures

If the `src/fetch.ts` module graph itself cannot load, that module cannot return
an application-structured response for its own import failure. The failure is
reported by the Astro/Vite development or build/standalone process boundary
instead. A structured HTTP diagnostic would require an outer host boundary.
