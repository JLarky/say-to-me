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

Default listen address: `http://127.0.0.1:43141` (`HOST` / `PORT` override). Bind is `0.0.0.0` so both local and VM preview work.

## Relay

Copy `.env.example` to `.env` and set the relay **IP** (not a hostname). The relay is HTTP/WebSocket only — no TLS.

| Variable | Required | Default | What it is |
|----------|----------|---------|------------|
| `RELAY_IP` | for `GET /relay` | — | Relay IPv4 address |
| `RELAY_PORT` | no | `4000` | Relay listen port |

`.env` is gitignored. `.env.example` keeps a placeholder IP, not a real one.

`GET /relay` calls `http://$RELAY_IP:$RELAY_PORT/health` and, on success, returns:

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

Missing `RELAY_IP` is `503`. An unreachable or non-ok relay is `502`. Local `GET /health` does not depend on the relay.

## Run locally

Requires Node 20+ and/or Bun 1.x. Install with whichever package manager you use:

```sh
pnpm install
# or: bun install
# or: npm install
```

```sh
cp .env.example .env
# set RELAY_IP to the relay IPv4 address
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
curl -s http://127.0.0.1:43141/relay
curl -s http://127.0.0.1:43141/openapi/json | head
```

Open `http://127.0.0.1:43141/openapi` for the docs UI.

```sh
pnpm lint
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
  config.ts                # HOST / PORT / RELAY_IP / RELAY_PORT, loads .env
  plugins/openapi.ts       # @elysiajs/openapi (Scalar at /openapi)
  modules/health/          # local health controller + TypeBox model
  modules/relay/           # Paseo relay probe
oxlint.config.ts
tools/oxlint/anti-slop/
```

Lint uses [anti-slop](https://github.com/dmmulroy/anti-slop) the way that project is meant to be used: the plugin is **vendored**, not an npm package. Generic rules are enabled in `oxlint.config.ts`. The Effect rule group is not registered (this app does not depend on Effect). Provenance lives in `tools/oxlint/anti-slop/UPSTREAM.md`. To refresh, ask an agent to update anti-slop while preserving local customizations.
