# API hosting migration: Effect routes → Web-native host (Elysia/Astro)

This doc captures _why_ the API is being reshaped around a host-agnostic
`Request` → `Response` seam, how that lines up with the in-progress Effect route
migration, and the follow-ups that build on it. It is the higher-level companion
to the per-route mechanics in [opencode-sdk.md](./opencode-sdk.md#effect-route-pattern).

## The three migrations

We have three separate-but-converging tracks. Each has its own motivation, and
they meet at one place: standard Web `Request`/`Response`.

| Track             | Goal                                                                                                       | Where it lives                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Effect routes** | Fast, deterministic tests via injectable workflows + fake layers; typed schemas; explicit dependency seams | `server/api-routes/*`                          |
| **API host**      | One process / one dev server; drop Express-specific glue; cleaner routing                                  | `server/api.ts` today, a Web-native host later |
| **Frontend**      | Optionally serve the React SPA from the same host (Astro shell + island)                                   | `src/*`                                        |

The key insight: **these tracks do not compete.** Migrated routes are served
through a single merged web handler of shape
`(request: Request) => Promise<Response>`. That is exactly the contract a
Web-native host (Elysia `src/fetch.ts`, an Astro adapter, a Hono app, plain
`Bun.serve`) wants. Finishing the Effect migration _is_ the preparation for
changing hosts.

```
Effect *Effect workflow           → fast unit tests (the performance goal)
sayToMeHttpApiWebHandler (merged) → framework-agnostic HTTP surface
host (Express today)              → dispatchApiRequest + Express adapter glue
host (Elysia/Astro later)         → calls the SAME dispatch seam, no Express
```

## What this change does

API routing is centralized in a host-neutral dispatch stack:

- [`server/api-routes/dispatch-api-request.ts`](../server/api-routes/dispatch-api-request.ts)
  — `dispatchApiRequest(request)` fans out to Effect JSON/upload routes and SSE.
- [`server/api-routes/effect-api.ts`](../server/api-routes/effect-api.ts) —
  `dispatchEffectApiRequest(request)` handles uploads (multipart / file
  streaming) and delegates JSON routes to the merged handler.
- [`server/api-routes/merged-api.ts`](../server/api-routes/merged-api.ts) —
  one `SayToMeApi` (`HttpApi.make("say-to-me")`) with 19 `HttpApiGroup`s, one
  `HttpApiBuilder.toWebHandler`, and `sayToMeHttpApiWebHandler` /
  `disposeSayToMeHttpApiHandler`.
- [`server/api-routes/sse-routes.ts`](../server/api-routes/sse-routes.ts) —
  `dispatchSseApiRequest(request)` for SSE streams (separate from HttpApi).

`dispatchEffectApiRequest` returns the route's `Response`, or `null` when no
route matches (plain 404 from the merged handler) so the caller can fall through
to SSE or a frontend renderer. Handler-level JSON 404s (e.g. VAPID not
configured) still pass through.

`server/api.ts` is Express adapter glue only: it calls `dispatchApiRequest`,
bridges through `expressRequestToWebRequest` / `pipeWebResponseToExpress`, and
falls through to static/SPA for non-API paths. A Web-native host will use the
same dispatch seam:

```ts
// Illustrative — Phase 4 host entry point.
const apiResponse = await dispatchApiRequest(request);
if (apiResponse) return apiResponse;
// ...fall through to the Astro/React frontend.
```

## Guardrails (what NOT to do)

These anti-patterns would spend effort without serving any of the three goals:

- **Do not rewrite Effect routes as native host routes** (e.g. Elysia `.get()`
  bodies). That forks the migration, drops the typed `HttpApi` schemas, and
  loses the fast Effect tests. The host should call `dispatchApiRequest` (or
  `dispatchEffectApiRequest`), not reimplement route bodies.
- **Do not switch hosts before route parity is verified.** Express remains the
  default host until the Web-native entry point is at parity.
- **Do not drop the `*Effect` workflow exports** when wiring a new host. They are
  the test-performance win; route modules keep `*Effect` + service layers even
  though per-module `toWebHandler` instances are gone.
- **Do not bundle a Bun runtime swap into the host change.** `better-sqlite3`,
  `sharp`, and the OpenTelemetry `http`/`express` patching are Node-native. A
  Web-native host can run on Node first; Bun is a separate decision.

## Follow-ups

Roughly in dependency order. Each is independently shippable.

1. **Continue Effect route migration** (per `opencode-sdk.md`, one route/PR).
   Prefer JSON CRUD with no SSE first: jarvis-timers (already has Effect
   services in `server/timers.ts`, just not `HttpApi`-wrapped), session
   `PATCH`/`DELETE`, notification dismiss. Each migration shrinks the legacy
   Express sub-app and removes a reason to keep `httpApiExpressHandler`.

2. ~~**Collapse to a single merged Effect web handler.**~~ Done: `SayToMeApi` in
   `merged-api.ts` composes 19 `HttpApiGroup`s behind one `toWebHandler`.
   `effectApiRoutes` / `findEffectApiRoute` are removed; `dispatchEffectApiRequest`
   calls `sayToMeHttpApiWebHandler` directly (uploads remain separate handlers in
   `uploads.ts` because multipart/file streaming is not HttpApi-shaped).

3. **Abstract SSE broadcast away from Express `Response`.** Done.
   (`server/sse/*`). SSE route handlers now live in
   `server/api-routes/sse-routes.ts` and are reachable through
   `dispatchSseApiRequest` / `dispatchApiRequest` without Express mounts.

4. **Stand up the Web-native host (Elysia + Astro).** Added `src/fetch.ts` (Elysia
   with an `astro()` fallback, per Astro 7 advanced routing) that:
   - calls `dispatchApiRequest` for all API routes,
   - returns JSON 404 for unmatched `/api/*` and `/say`,
   - falls through to the Astro/React frontend (`client:only` island).
     Astro/Elysia is now the only dev host: run it with
     `pnpm dev -- --background`. Use `portless` for a stable local URL
     instead of hard-coding host/port values in docs or scripts.
     Express (`server/index.ts`) remains the default production preview host until the
     broader parity checklist is complete. Build and run the web host with
     `pnpm build:web` then `pnpm preview:web`.

     Current smoke coverage for the Astro/Elysia dev path: SPA fallback, JSON API,
     POST `/say`, and `/api/events` SSE all respond correctly through `astro dev`.
     Browser automation also verified React island HMR: editing `_HomePage.tsx`
     updated visible text in the open browser without a manual reload. Server
     module reload was verified by temporarily editing `server/web-host.ts` to add
     an API response header and observing the new header on `/api/version` without
     restarting Astro dev.
     Elysia route-table reload was verified by temporarily adding
     `/api/__hmr_probe` in `src/fetch.ts`, observing a `200` JSON response, then
     removing the route and observing the expected JSON `404` without restarting
     Astro dev.

     Remaining replacement blockers before making Astro/Elysia the production
     default: broader parity smoke for session SSE,
     notification SSE, uploads, files, and representative mutating APIs; and
     confirming developer ergonomics for logs/restarts in daily use.

5. **Migrate wiring tests to the host's `Request` entry point.** Once routes are
   reachable through a single `Request` handler, integration tests can call that
   handler directly instead of `listen(createApiMiddleware())` + `fetch(origin)`,
   skipping TCP. The bulk of the test-performance win already comes from the
   `*Effect` workflow tests; this trims the remaining harness overhead.

6. **Decide the frontend story.** With the host serving both, choose between a
   single `client:only` React island (minimal churn) and per-page Astro routes
   (more work, little benefit for this real-time/SSE/TTS app). The island
   approach is the recommended ceiling unless static content is added.

## Temporary migration tests

These tests intentionally exercise the current Express adapter + Effect route
table while migrations are in flight. Once follow-up #5 moves wiring coverage to
the host's direct `Request` entry point, remove or replace these TCP-mounted
tests with direct handler tests:

- `server/notifications.test.ts` — `say API: notification dismiss` mounted
  notification list/dismiss `fetch` tests. Keep the route-local
  notification fake-service tests.
- `server/api.sessions.test.ts` — mounted session state `PATCH` tests. Keep the
  route-local session mutation effect tests.
- `server/api.push.test.ts` / `server/api.push-configured.test.ts` — mounted
  VAPID public key and push subscription tests. Keep the route-local push effect
  tests.
- `server/api.waiting-state.test.ts`, `server/api.notes.test.ts`,
  `server/api.messages.test.ts`, and related mounted API tests — waiting-state,
  note, message, queue, and utility route wiring. Keep route-local Effect
  workflow tests for migrated behavior.

## Status snapshot

- Migrated to Effect `HttpApi`: workspace-path, sessions, jarvis-status,
  jarvis-sessions, opencode-sessions, opencode-workspaces, opencode-stop,
  opencode-compact, opencode-model-controls, notification list/dismiss, session
  `PATCH`/`DELETE`, OpenCode title mutation, jarvis-timers, push subscription
  routes, waiting-state, queue/config utilities, notes, messages, dev reimport,
  OpenCode activity preview JSON, and uploads / attachment file serving
  (`server/api-routes/uploads.ts`).
- SSE broadcast abstraction (`server/sse/*`): queue/session-list/notification
  registries and OpenCode activity SSE writers use host-agnostic `SseClient`
  subscribers. SSE endpoints are dispatched via `dispatchSseApiRequest` /
  `dispatchApiRequest` and return Web `Response` streams (`createSseWebResponse`).
  Express adapts through `pipeWebResponseToExpress`.
- `server/api.ts` is host adapter glue only: middleware composition, Express ↔
  Web `Request`/`Response` bridging, JSON error normalization, and
  `dispatchApiRequest`. No legacy Express sub-app remains.
- Merged Effect handler: one `SayToMeApi` + one `toWebHandler` in
  `merged-api.ts` (was ~20 per-module handlers + manual `effectApiRoutes` table).
  Route modules export `*Group`, `build*Handlers(api)`, `*Effect` workflows, and
  live layers for tests.
- Upload routes (`/api/uploads/*`, `/api/message-attachments/*`) stay as
  dedicated web handlers in `uploads.ts` (not folded into HttpApi).
- Host: Express (`server/index.ts` in prod, the Vite dev plugin in dev) is the
  default. Elysia + Astro (`src/fetch.ts`, `pnpm build:web` +
  `pnpm preview:web`) is available as an alternate host with API parity via
  `dispatchApiRequest`.
- Seam: `server/api-routes/dispatch-api-request.ts` (`dispatchApiRequest`),
  `server/api-routes/effect-api.ts` (`dispatchEffectApiRequest`),
  `server/api-routes/merged-api.ts` (`sayToMeHttpApiWebHandler`),
  `server/api-routes/sse-routes.ts` (`dispatchSseApiRequest`),
  `server/host-runtime.ts` (`ensureHostRuntimeStarted` / `stopHostRuntime`),
  `server/web-host.ts` (`handleWebHostRequest`).
- Phase 4 (Web-native host) is done. Phase 5 (migrate wiring tests to the host
  `Request` entry point) is next.
