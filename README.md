# say-to-me2

Local [Elysia](https://elysiajs.com/) HTTP service. It runs on **Node** and **Bun**. This checkout is not locked to either runtime.

There is no auth, database, or extra process. The live product today is still the sibling `say-to-me` app; this slice adds a Paseo relay probe on top of health and OpenAPI.

## Endpoints

| Path | What it is |
|------|------------|
| `GET /health` | Local liveness: `{ "status": "ok" }` |
| `GET /relay` | Probes the configured Paseo relay over plain HTTP and returns health plus WebSocket URLs |
| `GET /openapi` | Scalar UI for the generated OpenAPI docs |
| `GET /openapi/json` | Raw OpenAPI JSON |
| `GET /` | Pointers to health, relay, and docs |

Default listen address: `http://127.0.0.1:43141` (`HOST` / `PORT` override via the process environment). Bind is `0.0.0.0` so both local and VM preview work. App code does not load `.env` files; use the shell or native Bun/Node env loading.

## Relay

Copy `.env.example` to `.env` and set `RELAY_URL` to the relay origin (HTTP only — no TLS). Bun loads `.env` from the working directory. Node scripts pass `--env-file=.env`. The app only reads `process.env`.

| Variable | Required | Default | What it is |
|----------|----------|---------|------------|
| `RELAY_URL` | for `GET /relay` | — | Relay origin, e.g. `http://127.0.0.1:4000` |

`.env` is gitignored. `.env.example` keeps a placeholder URL, not a real host.

`GET /relay` calls `$RELAY_URL/health` and, on success, returns:

```json
{
  "status": "ok",
  "relay": {
    "health": "http://127.0.0.1:4000/health",
    "ws": "ws://127.0.0.1:4000/ws",
    "tls": false
  },
  "upstream": { "status": "ok" }
}
```

Missing or non-http `RELAY_URL` is `503`. An unreachable or non-ok relay is `502`. Local `GET /health` does not depend on the relay.

## Run locally

Requires Node 24+ (native TypeScript type stripping) and/or Bun 1.x. Install with whichever package manager you use:

```sh
pnpm install
# or: bun install
# or: npm install
```

```sh
cp .env.example .env
# set RELAY_URL to the relay origin, e.g. http://127.0.0.1:4000
```

### Node

```sh
pnpm dev:node
# or: npm run dev:node
```

Node runs `src/index.ts` directly (`--watch` in dev). Production-style (no watch): `pnpm start:node`. Both pass `--env-file=.env`. TypeScript stays erasable (no enums, namespaces, or parameter properties).

### Bun

```sh
pnpm dev:bun
# or: bun run dev:bun
```

Bun runs `src/index.ts` directly and loads `.env` from the working directory. Production-style (no watch): `pnpm start:bun`.

The process picks the Elysia adapter from the runtime: native on Bun, `@elysiajs/node` on Node.

## Check it

```sh
curl -s http://127.0.0.1:43141/health
curl -s http://127.0.0.1:43141/relay
curl -s http://127.0.0.1:43141/openapi/json | head
```

Open `http://127.0.0.1:43141/openapi` for the docs UI.

```sh
pnpm lint
pnpm test          # Node (node --test)
pnpm test:bun      # Bun's test runner
pnpm typecheck
```

## Layout

```
src/
  index.ts                 # listen; runtime-selected adapter
  app.ts                   # compose plugins + modules (no listen)
  runtime.ts               # Bun vs Node adapter
  config.ts                # HOST / PORT / RELAY_URL from process.env
  decode-response-json.ts  # Effect Schema decoder for Response.json()
  plugins/openapi.ts       # @elysiajs/openapi (Scalar at /openapi)
  modules/health/          # local health controller + TypeBox model
  modules/relay/           # Paseo relay probe
oxlint.config.ts
tools/oxlint/anti-slop/
```

HTTP JSON in tests is decoded with [`decodeResponseJson`](src/decode-response-json.ts): `response.json()` plus an Effect `Schema`. Install Effect with `vp install effect@rc` (currently `effect@4` RC).

Lint uses [anti-slop](https://github.com/dmmulroy/anti-slop) the way that project is meant to be used: the plugin is **vendored**, not an npm package. Generic rules are enabled in `oxlint.config.ts`. The Effect rule group is not registered. Provenance lives in `tools/oxlint/anti-slop/UPSTREAM.md`. To refresh, ask an agent to update anti-slop while preserving local customizations.
