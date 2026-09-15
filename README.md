# say-to-me2

First slice of **say-to-me2**: a small local [Elysia](https://elysiajs.com/) HTTP service. It runs on **Node** and **Bun**. This checkout is not locked to either runtime.

There is no auth, database, or extra process. The live product today is still the sibling `say-to-me` app; this is a greenfield API starting with health and OpenAPI.

## Endpoints

| Path | What it is |
|------|------------|
| `GET /health` | Liveness: `{ "status": "ok" }` |
| `GET /openapi` | Scalar UI for the generated OpenAPI docs |
| `GET /openapi/json` | Raw OpenAPI JSON |
| `GET /` | Pointers to health and docs |

Default listen address: `http://127.0.0.1:43141` (`HOST` / `PORT` override). Bind is `0.0.0.0` so both local and VM preview work.

## Run locally

Requires Node 20+ and/or Bun 1.x. Install with whichever package manager you use:

```sh
pnpm install
# or: bun install
# or: npm install
```

### Node

```sh
pnpm dev:node
# or: npm run dev:node
```

`tsx` watches TypeScript. Production-style (no watch): `pnpm start:node`.

### Bun

```sh
pnpm dev:bun
# or: bun run dev:bun
```

Bun runs `src/index.ts` directly. Production-style (no watch): `pnpm start:bun`.

The process picks the Elysia adapter from the runtime: native on Bun, `@elysiajs/node` on Node.

## Check it

```sh
curl -s http://127.0.0.1:43141/health
curl -s http://127.0.0.1:43141/openapi/json | head
```

Open `http://127.0.0.1:43141/openapi` for the docs UI.

```sh
pnpm test          # Node (tsx + node:test)
pnpm test:bun      # Bun's test runner
pnpm typecheck
```

## Layout

```
src/
  index.ts                 # listen; runtime-selected adapter
  app.ts                   # compose plugins + modules (no listen)
  runtime.ts               # Bun vs Node adapter
  config.ts                # HOST / PORT
  plugins/openapi.ts       # @elysiajs/openapi (Scalar at /openapi)
  modules/health/          # health controller + TypeBox model
```
