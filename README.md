# Say To Me

<!-- CI probe: this comment intentionally has no runtime impact. -->

**Calm supervision for coding agents.**

Say To Me is a local, voice-first control plane for people juggling multiple AI coding
agents. It gives Codex, Claude Code, Cursor Agent, Grok, and OpenCode sessions one place
to be discovered, organized, contacted, monitored, and handed work.

The project started as a text-to-speech queue. It now solves a broader problem: when
several agents are working across repositories and providers, how do you remember who is
doing what, notice when work finishes, and intervene without living in five terminals?

Say To Me does not replace an agent runtime or model provider. It sits above them as a
local human-operations layer.

## What It Does

- **One session surface:** discover, import, create, rename, group, search, and open
  sessions from multiple agent providers.
- **Eyes-free updates:** hear concise agent replies through browser speech synthesis while
  keeping Markdown, links, images, and session references visible in the UI.
- **Durable messaging:** queue prompts and replies in SQLite, deliver them asynchronously,
  retry failures, and recover pending work after server restarts.
- **Cross-session delegation:** forward work with visible provenance, watch the target
  session, and notify the source session when the target returns to idle.
- **Session controls:** inspect activity, stop work, and manage provider-supported model
  and reasoning-effort settings.
- **Lightweight operations:** attach notes, schedule timers, organize sessions by project,
  receive push notifications, and inspect delivery state.
- **Local-first data:** keep conversations, coordination state, and runtime metadata on the
  machine running the agents.

## The Workflow

```text
you (browser, voice, or API)
            |
            v
       Say To Me
   session index + queue
   delegation + monitoring
   durable workflow state
            |
            v
  OpenCode | Codex | Claude | Cursor | Grok
```

A typical flow:

1. Open or create sessions for the projects you are supervising.
2. Send work from the browser or agent-facing API.
3. Delegate follow-up work from one session to another when useful.
4. Leave the terminal. Say To Me speaks important replies and pushes high-signal updates.
5. Return to the session, evidence, or artifact that needs a decision.

## Project Status

Say To Me is an actively developed personal/local tool. The provider integrations are
useful today, but capabilities vary because each upstream CLI exposes different session,
model, effort, activity, and resume behavior.

It is not yet a hosted multi-user service. There is no production-grade authentication or
tenant isolation, and local provider CLIs retain their own permissions and credentials.
Treat remote exposure as an advanced deployment that needs its own access controls.

## Quick Start

Prerequisites:

- [Vite+](https://viteplus.dev/) available as `vp`
- Any agent CLIs you want to supervise, installed and authenticated separately
- A browser with `speechSynthesis` support for spoken playback

Install dependencies and start the Astro/Elysia development host:

```sh
nub install   # preferred — faster; fallback: vp install or pnpm install
vp run dev
```

Open the URL printed by Astro. On machines using
[portless](https://github.com/vercel-labs/portless), `portless list` shows the stable local
route, commonly `https://say.local:1355`.

Useful server commands:

```sh
vp exec astro dev status
vp exec astro dev logs --follow
vp exec astro dev stop
```

### Provider Setup

| Provider     | Local dependency   | Notes                                                                       |
| ------------ | ------------------ | --------------------------------------------------------------------------- |
| OpenCode     | OpenCode server    | Defaults to `http://localhost:4096`; override with `SAY_TO_ME_OPENCODE_URL` |
| Codex        | `codex` CLI        | Uses local Codex sessions and credentials                                   |
| Claude Code  | `claude` CLI       | Uses local Claude sessions and credentials                                  |
| Cursor Agent | `cursor-agent` CLI | Uses local Cursor agent transcripts and credentials                         |
| Grok         | `grok` CLI         | Uses local Grok sessions and credentials                                    |

Missing providers fail soft: the rest of the app remains available.

## Agent-Facing API

The `scripts/say-to-me` helper documents the API conventions agents need to speak to the
right session without flooding voice output:

```sh
scripts/say-to-me usage
scripts/say-to-me usage jarvis
scripts/say-to-me usage timers
scripts/say-to-me usage api
```

To boot a **second** process from a worktree (custom port, separate sqlite, never live
5411 / `say.local`) and drive it with `say-to-me api --server` plus `agent-browser`, see
[`docs/isolated-e2e.md`](docs/isolated-e2e.md).

### `say-to-me api` CLI

Call a **running** server without auto-start (default `http://localhost:5411`, or
`SAY_TO_ME_URL` / `--server`). Response body goes to stdout (jq-friendly); non-2xx exits
non-zero and still prints the body.

```sh
# Raw method + path
say-to-me api GET /api/queue
say-to-me api GET /api/health

# Live OpenAPI operationId (+ path/query params)
say-to-me api health.getHealth
say-to-me api queue.getSessionQueue --param sessionId=ses_abc

# Body / headers (Content-Type defaults to application/json when --data is set)
say-to-me api POST /api/sessions/ses_abc/messages \
  --data '{"author":"agent","text":"the build passed"}'
echo '{"author":"agent","text":"hello"}' | \
  say-to-me api POST /api/sessions/ses_abc/messages --data=-
say-to-me api GET /openapi.json
```

OpenAPI is published at `GET /openapi.json` from the Effect `SayToMeApi` definition.

### curl examples

Send a spoken agent reply:

```sh
curl -S -X POST -k https://say.local:1355/api/sessions/<session-id>/messages \
  -H 'Content-Type: application/json' \
  -d '{"author":"agent","text":"the build passed"}'
```

Visual-only Markdown, links, images, and session cards can accompany the short spoken
message. See `scripts/say-to-me usage` for payload examples.

### Delegate Work Between Sessions

Forward through the source session so both sides retain provenance:

```sh
curl -S -X POST -k https://say.local:1355/api/sessions/<source-session-id>/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "author":"user",
    "targetSessionId":"<target-session-id>",
    "text":"investigate the failing integration test"
  }'
```

By default, Say To Me watches for the target to begin work and return to idle, then posts a
completion notice back to the source. Use `"notifyOnCompletion": false` only for
fire-and-forget forwarding. Workers should reply in their own session; return
relays paste their chat into yours (hard to read) and watch the coordinator
instead.

For efficient polling from another agent:

```sh
curl -S -k \
  'https://say.local:1355/api/sessions/<session-id>/jarvis-status?wait=5sec'
```

## Architecture

- **Frontend:** React, React Router, StyleX, and browser speech synthesis inside an Astro
  application.
- **API:** host-neutral Web `Request -> Response` dispatch, typed Effect `HttpApi` routes,
  and SSE streams served through Astro/Elysia in development.
- **Storage:** embedded SQLite accessed through Drizzle, with ArkType validation at runtime
  trust boundaries.
- **Delivery:** durable provider-specific jobs with leases, retries, idempotency, completion
  watches, and startup recovery.
- **Observability:** optional OpenTelemetry instrumentation for server and browser paths.

Correctness-critical workflow state belongs in SQLite. Timers, fibers, subscribers, and
caches are runtime helpers rebuilt from durable rows. See
[`docs/server-state-durability.md`](docs/server-state-durability.md) and
[`docs/database.md`](docs/database.md).

## Configuration

The app loads `.env` from the project root when present. Common settings:

| Variable                                 | Purpose                                               | Default                 |
| ---------------------------------------- | ----------------------------------------------------- | ----------------------- |
| `PORT`                                   | Server port                                           | `5173`                  |
| `SAY_TO_ME_DB`                           | SQLite database path                                  | `.local/queue.sqlite`   |
| `SAY_TO_ME_OPENCODE_URL`                 | OpenCode API base URL                                 | `http://localhost:4096` |
| `SAY_TO_ME_MAX_USER_MESSAGE_LENGTH`      | Maximum user prompt length                            | `32000`                 |
| `SAY_TO_ME_MAX_TOTAL_MESSAGES`           | Retained messages per pruning policy                  | `50`                    |
| `SAY_TO_ME_MAX_IMAGE_UPLOAD_BYTES`       | Image upload limit                                    | `10485760`              |
| `SAY_TO_ME_SSE_DIAGNOSTICS`              | Enable periodic SSE diagnostics logs                  | unset                   |
| `SAY_TO_ME_SSE_DIAG_VERBOSE`             | Include per-session broadcast detail in those logs    | unset                   |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Enable web push                                       | unset                   |
| `OTEL_BROWSER_ENABLED`                   | Enable browser telemetry when Honeycomb is configured | `false`                 |

Provider worker modes, cache intervals, upload limits, and observability settings have
additional environment controls in `server/config.ts` and `server/otel-config.ts`.
SSE counters and lifecycle instrumentation remain active regardless of logging. Set
`SAY_TO_ME_SSE_DIAGNOSTICS=1` to emit periodic diagnostics logs; set
`SAY_TO_ME_SSE_DIAG_VERBOSE=1` as well to include per-session broadcast detail.

## Development

Use Vite+ for project workflows:

```sh
vp check
vp run test
vp build
```

Database changes use Drizzle migrations and compatibility checks. Read
[`docs/database.md`](docs/database.md) before changing persistence. OpenCode integration
guidance lives in [`docs/opencode-sdk.md`](docs/opencode-sdk.md).

## Direction

The product direction is **calm supervision of many heterogeneous agents**, not another
generic chat UI. The highest-leverage work — durable tasks and runs, unified provider
adapters, managed worktree isolation, recovery hardening, and operations health metrics —
is written up in [`docs/roadmap.md`](docs/roadmap.md), each item with its open design
questions. See also [Adding a provider](docs/spec/adding-provider.md).

Longer term, Say To Me should make ownership, progress, evidence, blockers, and approvals
obvious across providers while remaining local-first and compatible with the tools agents
already use.

## License

Say To Me is licensed under the [GNU Affero General Public License v3.0](LICENSE). Because
Say To Me is normally run as a server, the AGPL's network clause applies: if you offer a
modified version to users over a network, you must also offer them its source.

Third-party assets bundled in this repository are listed in
[`THIRD-PARTY.md`](THIRD-PARTY.md).
