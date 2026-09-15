# say-to-me2

Local [Elysia](https://elysiajs.com/) HTTP service. It runs on **Node** and **Bun**. This checkout is not locked to either runtime.

There is no auth, database, or extra process. The live product today is still the sibling `say-to-me` app; this slice adds a Paseo relay probe on top of health and OpenAPI.

## Endpoints

| Path | What it is |
|------|------------|
| `GET /health` | Local liveness: `{ "status": "ok" }` |
| `GET /relay` | WebSocket round-trip: e2ee_hello + random string echo |
| `GET /openapi` | Scalar UI for the generated OpenAPI docs |
| `GET /openapi/json` | Raw OpenAPI JSON |
| `GET /` | Pointers to health, relay, and docs |

Default listen address: `http://127.0.0.1:43141` (`HOST` / `PORT` override). Bind is `0.0.0.0` so both local and VM preview work.

## Relay

Copy `.env.example` to `.env` and set `RELAY_URL` to the relay origin. Bun loads `.env` from the working directory. Node scripts pass `--env-file=.env`. The app only reads `process.env`.

| Variable | Required | Default | What it is |
|----------|----------|---------|------------|
| `RELAY_URL` | yes (boot) | — | Relay origin, e.g. `http://127.0.0.1:4000` |

`.env` is gitignored. `.env.example` keeps a placeholder URL, not a real host.

`RELAY_URL` is validated at process start with [T3 Env](https://env.t3.gg/docs/introduction). Missing or non-http(s) values prevent listen. Local `GET /health` still does not talk to the relay, but the process will not start without a valid `RELAY_URL`.

`GET /relay` opens a v2 WebSocket pair (`role=server` + `role=client`, shared `serverId`), sends `{ type: "e2ee_hello", key }` where `key` is canonical Base64 of a 32-byte X25519 public key (Elixir drops anything else with `1008`), then echoes a random string through the relay. On success:

```json
{
  "status": "ok",
  "relay": {
    "health": "http://127.0.0.1:4000/health",
    "ws": "ws://127.0.0.1:4000/ws",
    "tls": false
  },
  "payload": "…",
  "echoed": "…",
  "serverId": "say-to-me2-…"
}
```

A failed round-trip is `502`.

## Run locally

Requires Node 20+ and/or Bun 1.x. Install with whichever package manager you use:

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

`tsx` is loaded by Node (`--import tsx --watch`). Production-style (no watch): `pnpm start:node`. Both pass `--env-file=.env`.

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
  config.ts                # HOST / PORT / RELAY_URL via t3-env (process.env)
  plugins/openapi.ts       # @elysiajs/openapi (Scalar at /openapi)
  modules/health/          # local health controller + TypeBox model
  modules/relay/           # Paseo relay WebSocket round-trip
oxlint.config.ts
tools/oxlint/anti-slop/
```

Lint uses [anti-slop](https://github.com/dmmulroy/anti-slop) the way that project is meant to be used: the plugin is **vendored**, not an npm package. Generic rules are enabled in `oxlint.config.ts`. The Effect rule group is not registered (this app does not depend on Effect). Provenance lives in `tools/oxlint/anti-slop/UPSTREAM.md`. To refresh, ask an agent to update anti-slop while preserving local customizations.
