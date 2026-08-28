# Isolated end-to-end testing

This is the agent-facing recipe for driving a **second** Say To Me process from a git worktree (or any checkout) without touching the live shared instance.

There is no product Playwright pack. Vitest (`vp run test`) plus `server/api.harness.ts` covers in-process API behavior. This document is for **process-level** smoke: boot a real server, hit its HTTP API, and optionally click the UI with `agent-browser`.

## Do not use the live instance

The machine already has a shared app. Agents find it with `portless list` (`say.local` → some localhost port). `astro.config.mjs` also defaults the dev server to port **5411**. Bare `say-to-me api` / `SAY_TO_ME_URL` default to `http://localhost:5411`.

Isolated e2e must **not**:

- bind port **5411**
- call `https://say.local:1355` or any `say.local` URL
- reuse the live SQLite file (`.local/queue.sqlite` in the main checkout, or an absolute `SAY_TO_ME_DB` from live `.env`)
- point at the live OpenCode server (`http://localhost:4096`) unless the scenario is explicitly about OpenCode
- inherit the live CLI homedir (that would list real Claude/Cursor/Codex/Grok sessions)
- autostart live-named Boo workers (`stm-<sessionId>`). Isolated ports use `stm_<port>_<sessionId>` (e.g. `stm_5412_cur_abc`) so they do not collide; keep autostart off unless the smoke creates a real CLI agent

If `vp exec astro dev status` in the worktree shows 5411, stop and start again on a different port.

## Isolation env

Pick an unused loopback port. Examples below use `5416`.

```bash
PORT=5416
ORIGIN="http://127.0.0.1:${PORT}"
DATA="/tmp/say-to-me-e2e-data"
mkdir -p "$DATA"

export PORT
export SAY_TO_ME_DB="$DATA/queue.sqlite"
export SAY_TO_ME_INTERNAL_URL="$ORIGIN"
export SAY_TO_ME_URL="$ORIGIN"
export SAY_TO_ME_OPENCODE_URL="http://127.0.0.1:1"
export SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT="$DATA/cli-home"
export SAY_TO_ME_CLAUDE_WORKER_AUTOSTART=0
export SAY_TO_ME_CURSOR_WORKER_AUTOSTART=0
export SAY_TO_ME_CODEX_WORKER_AUTOSTART=0
export SAY_TO_ME_GROK_WORKER_AUTOSTART=0
```

| Variable                            | Why                                                                   |
| ----------------------------------- | --------------------------------------------------------------------- |
| `PORT` + Astro `--port`             | Config hardcodes 5411; you must pass `--port` or you fight live.      |
| `SAY_TO_ME_DB`                      | Separate sqlite. Default is `<cwd>/.local/queue.sqlite`.              |
| `SAY_TO_ME_INTERNAL_URL`            | Loopback origin so workers do not remap `say.local` to this checkout. |
| `SAY_TO_ME_URL`                     | Makes the helper CLI target this process.                             |
| `SAY_TO_ME_OPENCODE_URL`            | Dummy URL so you do not share live OpenCode.                          |
| `SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT` | Empty CLI home so discovery does not see live sessions.               |
| `SAY_TO_ME_*_WORKER_AUTOSTART=0`    | Do not spawn real CLIs.                                               |

Do not copy the live checkout `.env` into the worktree. If you need env, write a file that only contains the block above.

Optional echo workers (fake CLI delivery, no real providers):

```bash
export SAY_TO_ME_CLAUDE_WORKER_MODE=echo
export SAY_TO_ME_CURSOR_WORKER_MODE=echo
export SAY_TO_ME_CODEX_WORKER_MODE=echo
export SAY_TO_ME_GROK_WORKER_MODE=echo
export SAY_TO_ME_CLAUDE_WORKER_AUTOSTART=1
# shorten the default 10s accept / 60s reply if you wait on delivery
export SAY_TO_ME_CLAUDE_ECHO_ACCEPT_DELAY_MS=100
export SAY_TO_ME_CLAUDE_ECHO_REPLY_DELAY_MS=200
```

## Boot from a worktree

```bash
git worktree add /tmp/say-to-me-e2e -b e2e/worktree-pack main
cd /tmp/say-to-me-e2e
export PATH="$HOME/.vite-plus/bin:$PATH"
nub install   # or vp install

# export the isolation env from the previous section, then:
vp run check && vp run test

vp exec astro dev --port "$PORT" --host 127.0.0.1 --background
vp exec astro dev status   # must show $PORT, never 5411
curl -sS "http://127.0.0.1:${PORT}/api/health"
```

Product `createWorktree` only makes an agent git checkout. It does **not** start a second Say To Me server. You still have to boot Astro with the env above.

Prod-like (optional):

```bash
vp run build:web
PORT="$PORT" vp exec node ./dist/server/entry.mjs
```

Stop **from the worktree cwd**:

```bash
vp exec astro dev stop
```

## How agents call this origin

Bare `say-to-me api …` talks to the live `say.local` instance. Isolated e2e must pin the origin on every call.

### Helper CLI

```bash
# one-shot
say-to-me api --server "$ORIGIN" GET /api/health

# or export for the rest of the shell
export SAY_TO_ME_URL="$ORIGIN"
say-to-me api GET /api/health
say-to-me api POST /say --data '{"text":"queue smoke"}'
say-to-me api GET /api/queue
```

`--server` / `SAY_TO_ME_URL` must be `http://127.0.0.1:$PORT`, not `https://say.local:1355`.

Voice replies, relays, and session cards use the same helper, still pointed at `$ORIGIN`:

```bash
say-to-me api --server "$ORIGIN" POST /api/sessions/<session-id>/messages \
  --data '{"author":"agent","text":"health check passed"}'
```

### curl

Isolated HTTP is plain `http://127.0.0.1`. Do not use `-k` (that is for live `say.local` TLS).

```bash
curl -sS "http://127.0.0.1:${PORT}/api/health"
curl -sS -X POST "http://127.0.0.1:${PORT}/say" \
  -H 'Content-Type: application/json' \
  -d '{"text":"queue smoke"}'
curl -sS "http://127.0.0.1:${PORT}/api/queue"
curl -sS "http://127.0.0.1:${PORT}/api/does-not-exist"
# expect {"status":404,"error":"Not found."} — see docs/spec/agent-curl-api-errors.md
```

### agent-browser

Open **only** the isolated origin. Never `say.local`.

```bash
agent-browser open "http://127.0.0.1:${PORT}/"
agent-browser snapshot
```

UI TTS needs a real browser with `speechSynthesis`. Drive clicks/typing against `$ORIGIN` session URLs (`http://127.0.0.1:$PORT/ses/<id>`). Confirm `agent-browser` shows that host/port in the snapshot before asserting UI.

## Smoke checklist (isolated origin)

Run against `$ORIGIN` only:

1. `GET /api/health` → 200
2. `GET /` → HTML (or agent-browser snapshot of home)
3. Unknown `/api/*` → JSON `{status, error}` (not HTML)
4. `POST /say` then `GET /api/queue` → the text is queued
5. Create a session, `POST` a message, `GET` `/api/sessions/<id>/jarvis-status`
6. Forward with `targetSessionId` (source session keeps provenance)
7. Optional: message-controls force-send; echo-worker delivery if those env vars are on
8. Optional: agent-browser snapshot of `/ses/<id>` after a message appears

Then `vp exec astro dev stop` from the worktree and leave live 5411 / `say.local` alone.

## Isolated origin in agent prompts and Boo names

When this process is **not** live 5411 / `say.local`:

- Delivery prompts include: this session requires `say-to-me api --server http://127.0.0.1:$PORT` on every call. Do not use `say.local`.
- Boo worker names are `stm_<port>_<sessionId>` (example: `stm_5412_cur_abc`) instead of live `stm-<sessionId>`.

## What this is not

- **Not** `vp run check && vp run test`. That is the ship gate; it does not boot a second process.
- **Not** live 5411 / `say.local` smoke (e2e validator, e2e source, hold vs Force send). Those hit the shared instance.
- **Not** a committed `scripts/e2e-worktree.sh` yet. Until one exists, copy the env + `--server` / `SAY_TO_ME_URL` pattern above.
