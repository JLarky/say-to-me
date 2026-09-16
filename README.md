# say-to-me2

Local [Elysia](https://elysiajs.com/) HTTP service. It runs on **Node** and **Bun**. This checkout is not locked to either runtime.

There is no auth, database, or extra process. The live product today is still the sibling `say-to-me` app; this slice adds a relay WebSocket round-trip on top of health and OpenAPI, plus an in-process Specter command that records a successful pair and a query that lists paired clients.

## Endpoints

| Path                | What it is                                                                     |
| ------------------- | ------------------------------------------------------------------------------ |
| `GET /health`       | Local liveness: `{ "status": "ok" }`                                           |
| `GET /relay`        | WebSocket round-trip: e2ee_hello plus a random string echoed through the relay |
| `GET /openapi`      | Scalar UI for the generated OpenAPI docs                                       |
| `GET /openapi/json` | Raw OpenAPI JSON                                                               |
| `GET /`             | Pointers to health, relay, and docs                                            |

Default listen address: `http://127.0.0.1:43141` (`HOST` / `PORT` override via the process environment). Bind is `0.0.0.0` so both local and VM preview work. App code does not load `.env` files; use the shell or native Bun/Node env loading.

## Relay

Copy `.env.example` to `.env` and set `RELAY_URL` to the relay origin. Bun loads `.env` from the working directory. Node scripts pass `--env-file=.env`. The app only reads `process.env`.

`RELAY_URL` is validated at process start with [T3 Env](https://env.t3.gg/docs/standard-schema) and [Effect Schema](https://effect.website/docs/schema/standard-schema/) (Standard Schema v1). There is no Zod dependency. Missing or non-http(s) values prevent listen. Local `GET /health` still does not talk to the relay, but the process will not start without a valid `RELAY_URL`.

| Variable    | Required   | Default | What it is                                 |
| ----------- | ---------- | ------- | ------------------------------------------ |
| `RELAY_URL` | yes (boot) | —       | Relay origin, e.g. `http://127.0.0.1:4000` |

`.env` is gitignored. `.env.example` keeps a placeholder URL, not a real host.

`GET /relay` opens three v2 WebSockets that share `serverId`: a control socket (`role=server`, no `connectionId`) to register the server, plus a client ↔ server-data pair. The payload path is client ↔ server-data; the round-trip does not wait for control `connected`. It sends `{ type: "e2ee_hello", key }` where `key` is canonical Base64 of a 32-byte X25519 public key, then echoes a random string through the relay. The whole round-trip is bounded by 3 seconds and sockets are `terminate()`d on the way out. On success:

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

A failed round-trip is `502`. Local `GET /health` does not depend on the relay.

## Paired clients (Specter)

[`@specter-ts/core@0.2.1`](https://github.com/devagrawal09/specter) owns the domain in-process. Core has no HTTP. This checkout does not add pair or login routes. A later `paseo daemon pair` login flow can commit here after a successful pair; this slice is not the pairing protocol (no QR, link, or daemon talk).

| Specter                    | Input          | Result                                          |
| -------------------------- | -------------- | ----------------------------------------------- |
| command `recordPair`       | `{ clientId }` | appends `client-paired` (idempotent per client) |
| query `pairedClientsQuery` | `{}`           | `{ clients: [{ clientId, pairedAt }] }`         |

`clientId` is a stable client identity. `pairedAt` is when the successful pair was recorded. The event log is in-memory (process lifetime; resets on restart). Tests call Specter directly.

## Run locally

Requires Node 24+ (native TypeScript type stripping) and/or Bun 1.x. Install with Vite+ (`vp install`) or whichever package manager you use:

```sh
vp install
# or: pnpm install
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
pnpm check         # vp check: format, lint, typecheck
pnpm test          # Node (node --test)
pnpm test:bun      # Bun's test runner
```

GitHub Actions uses [gha-ts](https://github.com/JLarky/gha-ts) and, like `main`, runs `vp check` (not `pnpm lint`) on pushes to `new` and pull requests targeting `new`. Tests stay on `vp run test` and `vp run test:bun`. After editing `.github/workflows/*.main.ts`, run `node .github/workflows/ci.main.ts` and commit the generated YAML.

## Layout

```
src/
  index.ts                 # listen; runtime-selected adapter
  app.ts                   # compose plugins + modules (no listen)
  runtime.ts               # Bun vs Node adapter
  config.ts                # HOST / PORT / RELAY_URL via t3-env + Effect Schema (process.env)
  decode-response-json.ts  # Effect Schema decoders for JSON text and Response.json()
  plugins/openapi.ts       # @elysiajs/openapi (Scalar at /openapi)
  modules/health/          # local health controller + TypeBox model
  modules/relay/           # relay WebSocket round-trip
  specter/                 # in-process recordPair + pairedClientsQuery
vite.config.ts             # Vite+ `vp check` (fmt, lint, typecheck)
tools/oxlint/anti-slop/
.github/workflows/         # gha-ts source + generated YAML

```

HTTP JSON in tests is decoded with [`decodeResponseJson`](src/decode-response-json.ts): `response.json()` plus an Effect `Schema`. JSON text (including WebSocket frames) uses `decodeJsonText` with a real schema (object, struct, or union of known shapes). `JSON.parse` is banned by `anti-slop/no-json-parse`. Effect `Schema.Json` is banned by `anti-slop/no-schema-json` — it is as untyped as `as unknown`. Assertions `as unknown`, `as object`, and `as any` are banned by `anti-slop/no-broad-type-assertion`.

Lint uses [anti-slop](https://github.com/dmmulroy/anti-slop) the way that project is meant to be used: the plugin is **vendored**, not an npm package. Generic rules and the Effect plugin are enabled in the `lint` block of `vite.config.ts`. Provenance lives in `tools/oxlint/anti-slop/UPSTREAM.md`. To refresh, ask an agent to update anti-slop while preserving local customizations.
