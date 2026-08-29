# Isolated end-to-end testing

Copy-paste recipe for a **second** Say To Me process. A smaller model must be able to run this without implied context.

There is no product Playwright pack. Vitest (`vp run test`) plus `server/api.harness.ts` covers in-process API behavior. This document is **process-level**: boot a real server, hit its HTTP API, then (separately) run a real Cursor provider pass.

**HTTP smoke does not satisfy a Cursor pass.** Echo workers, `delivery sent`, and idle with only the user message are smoke. A real Cursor pass is a later section with its own fail cases.

## Hard rules (read before any command)

- Do **not** bind port **5411**. Do **not** stop, restart, or kill live 5411 / `say.local`.
- Do **not** call `https://say.local:1355` or any `say.local` URL.
- Do **not** copy live `.env` into the worktree.
- Do **not** export `SAY_TO_ME_URL` to the isolated origin in a live 5411 driver shell. That sends the driver's own voice to the isolated process.
- Isolated helper calls always use `--server http://127.0.0.1:$PORT` on **every** command. Voice from a live 5411 Jarvis/driver session always uses `--server http://127.0.0.1:5411`.
- Isolated workers never kill live `stm-<id>`. Stop only `stm_<port>_<id>`.
- Isolated sessions live in the isolated sqlite. They **404** on live 5411. Do **not** stop the isolated server until that independent check is done.

Prefer example port **5416**. Do not reuse **5412** unless you have already proven the listener cwd is this worktree (a leftover `/tmp/say-to-me-isolated-5412` process can occupy 5412 with health that is not `{ok:true}`).

---

## 1. Isolation env

Set these in the **driver** shell. They are not `SAY_TO_ME_URL`.

```bash
PORT=5416
ORIGIN="http://127.0.0.1:${PORT}"
WT="$PWD"   # must be the isolated worktree cwd, not the live checkout
DATA="/tmp/say-to-me-e2e-data-${PORT}"
mkdir -p "$DATA"

echo "PORT=$PORT ORIGIN=$ORIGIN WT=$WT"
echo "driver SAY_TO_ME_URL=${SAY_TO_ME_URL:-<unset>}"
```

**PASS:** `PORT` is not 5411. `WT` is this worktree. `SAY_TO_ME_URL` is empty, unset, `http://127.0.0.1:5411`, or `http://localhost:5411`.

**FAIL:** `PORT=5411`. `SAY_TO_ME_URL` is `http://127.0.0.1:5416` (or any isolated origin) in this live driver shell. Fix: `unset SAY_TO_ME_URL`.

**FAIL:** you copied live `.env` into the worktree (`cp …/.env "$WT/.env"`). Delete that file. Write only the server env below.

Server env belongs in a **subshell** at boot (next section) so it cannot leak into the driver. Do **not** export `SAY_TO_ME_CURSOR_WORKER_MODE=echo` if you intend a real Cursor pass later.

HTTP-only server env (no real CLIs):

```bash
# Values for the boot subshell only. Do not export SAY_TO_ME_URL in the parent.
# SAY_TO_ME_DB="$DATA/queue.sqlite"
# SAY_TO_ME_INTERNAL_URL="$ORIGIN"
# SAY_TO_ME_URL="$ORIGIN"
# SAY_TO_ME_OPENCODE_URL="http://127.0.0.1:1"
# SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT="$DATA/cli-home"
# SAY_TO_ME_CLAUDE_WORKER_AUTOSTART=0
# SAY_TO_ME_CURSOR_WORKER_AUTOSTART=0
# SAY_TO_ME_CODEX_WORKER_AUTOSTART=0
# SAY_TO_ME_GROK_WORKER_AUTOSTART=0
```

| Variable                            | Why                                                                 |
| ----------------------------------- | ------------------------------------------------------------------- |
| `PORT` + Astro `--port`             | Config hardcodes 5411; you must pass `--port` or you fight live.    |
| `SAY_TO_ME_DB`                      | Separate sqlite. Default is `<cwd>/.local/queue.sqlite`.            |
| `SAY_TO_ME_INTERNAL_URL`            | Worker-side isolation opt-in and loopback origin for this checkout. |
| `SAY_TO_ME_URL`                     | **Server/worker only.** Never export this in a live 5411 shell.     |
| `SAY_TO_ME_OPENCODE_URL`            | Dummy URL so you do not share live OpenCode.                        |
| `SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT` | Empty CLI home so discovery does not see live sessions.             |
| `SAY_TO_ME_*_WORKER_AUTOSTART=0`    | HTTP smoke. Cursor pass turns Cursor autostart on in section 4.     |

Optional echo workers are **HTTP/delivery smoke only**. They cannot pass section 4:

```bash
# SMOKE ONLY — do not set these if you will run the REAL Cursor pass on this boot.
# export SAY_TO_ME_CURSOR_WORKER_MODE=echo
# export SAY_TO_ME_CURSOR_WORKER_AUTOSTART=1
```

---

## 2. Boot

### 2.1 Worktree

```bash
# Example new worktree (or use an existing isolated checkout as WT):
git worktree add /tmp/say-to-me-e2e -b e2e/worktree-pack main
cd /tmp/say-to-me-e2e
WT="$PWD"
export PATH="$HOME/.vite-plus/bin:$PATH"
nub install   # or vp install
```

**PASS:** `test -d node_modules` is true after install.

**FAIL:** install dies on a `prepare` Node flag (`vp config` / `effect-language-service patch`). If `node_modules` already exists, **continue**. Do not copy live `.env` to “fix” install.

**FAIL:** `WT` is the live shared checkout that serves 5411.

Optional (not required for HTTP smoke):

```bash
vp run check && vp run test
```

Product `createWorktree` only makes an agent git checkout. It does **not** start a second Say To Me server.

### 2.2 Port occupancy (listening is not enough)

```bash
# Live 5411 must stay up. Do not stop it.
curl -sS "http://127.0.0.1:5411/api/health"
# PASS: {"ok":true}   FAIL: you cannot reach live 5411 — stop and ask; do not bind 5411.

ss -ltnp "sport = :${PORT}" || true
```

If `$PORT` is already bound:

```bash
PID=$(ss -ltnp "sport = :${PORT}" | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
echo "pid=$PID cwd=$(readlink /proc/${PID}/cwd)"
curl -sS "http://127.0.0.1:${PORT}/api/health" || true
```

**PASS:** nothing listens on `$PORT`, or the listener cwd **is** `$WT` and health is `{"ok":true}`.

**FAIL:** something listens but cwd is `/tmp/say-to-me-isolated-5412`, `/tmp/say-to-me-e2e`, or any checkout that is not `$WT`. Health 500 / 503 / `{"ok":false}` is a leftover, not “port in use so we are done.”

Stop **only** that leftover isolated process:

```bash
# From the leftover cwd, not from live 5411:
(cd "$(readlink /proc/${PID}/cwd)" && vp exec astro dev stop) || kill "$PID"
# NEVER: kill a process whose listen port is 5411
# NEVER: vp exec astro dev stop from the live checkout
# NEVER: fuser -k 5411/tcp
```

Then confirm live 5411 is still `{"ok":true}` and `$PORT` is free.

If `ss` is missing:

```bash
lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN
# then: ls -l /proc/<pid>/cwd   or   lsof -a -p <pid> -d cwd
```

### 2.3 Start Astro in a subshell

```bash
cd "$WT"
(
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
  vp exec astro dev --port "$PORT" --host 127.0.0.1 --background
)
vp exec astro dev status   # must show $PORT, never 5411
```

Confirm health from **this** worktree origin:

```bash
curl -sS "http://127.0.0.1:${PORT}/api/health"
echo "driver SAY_TO_ME_URL=${SAY_TO_ME_URL:-<unset>}"
```

**PASS:** body is `{"ok":true}`. `vp exec astro dev status` shows `$PORT`. Driver `SAY_TO_ME_URL` is still not the isolated origin.

**FAIL:** health 500/503, `{"ok":false}`, empty, or HTML. You are talking to a leftover process or the wrong sqlite. Stop that leftover (section 2.2) and boot again from `$WT`.

**FAIL:** status shows 5411. Stop this worktree server (`vp exec astro dev stop` from `$WT` only) and start again on `$PORT`.

Prod-like (optional, not the default recipe):

```bash
vp run build:web
(
  export PORT SAY_TO_ME_DB="$DATA/queue.sqlite" SAY_TO_ME_INTERNAL_URL="$ORIGIN" SAY_TO_ME_URL="$ORIGIN"
  PORT="$PORT" vp exec node ./dist/server/entry.mjs
)
```

---

## 3. HTTP smoke checklist

Every call pins `--server "$ORIGIN"` or uses `curl` to `http://127.0.0.1:${PORT}`. Isolated HTTP is plain `http://127.0.0.1`. Do not use `-k` (that is for live `say.local` TLS).

Do **not** `export SAY_TO_ME_URL="$ORIGIN"` here.

### 3.1 Health

```bash
curl -sS "http://127.0.0.1:${PORT}/api/health"
say-to-me api --server "$ORIGIN" GET /api/health
```

**PASS:** `{"ok":true}` (HTTP 200).

**FAIL:** 500, 503, `{"ok":false}`, connection refused, or a body from 5411.

### 3.2 Home HTML

```bash
curl -sS -D /tmp/iso-home.hdr -o /tmp/iso-home.html "http://127.0.0.1:${PORT}/"
head -n 5 /tmp/iso-home.hdr
head -c 120 /tmp/iso-home.html; echo
```

**PASS:** HTTP 200 and the body is HTML (`<!` / `<html`).

**FAIL:** JSON only, 404, or you opened `say.local`.

Optional UI:

```bash
agent-browser open "http://127.0.0.1:${PORT}/"
agent-browser snapshot
```

**PASS:** snapshot host/port is `127.0.0.1:$PORT`.

**FAIL:** snapshot shows `say.local` or port 5411.

### 3.3 JSON 404

```bash
curl -sS "http://127.0.0.1:${PORT}/api/does-not-exist"
```

**PASS:** `{"status":404,"error":"Not found."}` (see `docs/spec/agent-curl-api-errors.md`).

**FAIL:** HTML 404 page.

### 3.4 Queue

```bash
curl -sS -X POST "http://127.0.0.1:${PORT}/say" \
  -H 'Content-Type: application/json' \
  -d '{"text":"queue smoke"}'
curl -sS "http://127.0.0.1:${PORT}/api/queue"
```

**PASS:** queue JSON contains `queue smoke`.

**FAIL:** empty queue, or the text only appears on live 5411 (`curl -sS http://127.0.0.1:5411/api/queue`).

### 3.5 Forward (`targetSessionId`)

```bash
SRC=$(say-to-me api --server "$ORIGIN" POST /api/cli-sessions \
  --data '{"provider":"voice","name":"iso-src"}' | jq -r .session.id)
DST=$(say-to-me api --server "$ORIGIN" POST /api/cli-sessions \
  --data '{"provider":"voice","name":"iso-dst"}' | jq -r .session.id)
echo "SRC=$SRC DST=$DST"

say-to-me api --server "$ORIGIN" POST "/api/sessions/${SRC}/messages" \
  --data "{\"author\":\"user\",\"text\":\"forward smoke\",\"targetSessionId\":\"${DST}\"}"

echo "source:"; say-to-me api --server "$ORIGIN" GET "/api/sessions/${SRC}/messages"
echo "dest:";   say-to-me api --server "$ORIGIN" GET "/api/sessions/${DST}/messages"
```

**PASS:** `SRC` and `DST` start with `vo_`. Source keeps provenance. Dest has the forwarded user text.

**FAIL:** create/post without `--server` (hits live 5411). Session ids you already knew from live. HTTP smoke **done**. This is **not** a Cursor pass.

Do **not** run `vp exec astro dev stop` yet.

---

## 4. REAL Cursor pass checklist

HTTP smoke above must not be treated as this section. If this boot used `SAY_TO_ME_CURSOR_WORKER_MODE=echo`, **stop this isolated server** (section 6) and boot again **without echo**. Echo + delivery `sent` + idle is smoke only.

### 4.1 Fail cases (any one is a FAIL for this section)

- `SAY_TO_ME_CURSOR_WORKER_MODE=echo`
- Delivery status `sent` and session idle **without** an `author=agent` reply
- `jarvis-status` `waitingState` `can_continue` (or idle) with **only** the user message — **false idle**
- Boo name `stm-<sessionId>` (live naming). Isolated name is `stm_<port>_<sessionId>`
- Worker env missing `SAY_TO_ME_URL=http://127.0.0.1:$PORT`, or pointing at 5411 / `say.local`
- You `export SAY_TO_ME_URL="$ORIGIN"` in the live 5411 driver shell
- You `boo kill stm-<id>` (live worker)

### 4.2 Reboot isolated with real Cursor workers

Stop only the isolated server (from `$WT`), not 5411:

```bash
cd "$WT"
vp exec astro dev stop
curl -sS "http://127.0.0.1:5411/api/health"   # PASS: still {"ok":true}
```

Boot again with Cursor mode **cursor** (not echo):

```bash
cd "$WT"
(
  export PORT
  export SAY_TO_ME_DB="$DATA/queue.sqlite"
  export SAY_TO_ME_INTERNAL_URL="$ORIGIN"
  export SAY_TO_ME_URL="$ORIGIN"
  export SAY_TO_ME_OPENCODE_URL="http://127.0.0.1:1"
  export SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT="$DATA/cli-home"
  export SAY_TO_ME_CLAUDE_WORKER_AUTOSTART=0
  export SAY_TO_ME_CODEX_WORKER_AUTOSTART=0
  export SAY_TO_ME_GROK_WORKER_AUTOSTART=0
  export SAY_TO_ME_CURSOR_WORKER_MODE=cursor
  export SAY_TO_ME_CURSOR_WORKER_AUTOSTART=1
  vp exec astro dev --port "$PORT" --host 127.0.0.1 --background
)
curl -sS "http://127.0.0.1:${PORT}/api/health"
# PASS: {"ok":true}
```

### 4.3 Create a Cursor session on the isolated origin

`modelID` must be a Cursor model this machine has (in-repo example: `composer-1`). `path` must be an absolute directory.

```bash
CUR=$(say-to-me api --server "$ORIGIN" POST /api/cli-sessions \
  --data "{\"provider\":\"cursor\",\"path\":\"${WT}\",\"modelID\":\"composer-1\"}" \
  | jq -r .session.id)
echo "CUR=$CUR"
```

**PASS:** `CUR` starts with `cur_`.

**FAIL:** empty, error JSON, or an id copied from live 5411.

### 4.4 Boo worker name + origin env

```bash
NAME="stm_${PORT}_${CUR}"
echo "expect boo name $NAME"
boo ls --json
boo ls --json | jq --arg n "$NAME" '.[] | select(.name==$n)'
ps auxww | grep "[S]AY_TO_ME_CURSOR_WORKER_MODE=cursor" | grep "SAY_TO_ME_URL=http://127.0.0.1:${PORT}" || true
```

**PASS:** `boo ls` shows `stm_<port>_<id>` (example: `stm_5416_cur_…`). Process command includes `SAY_TO_ME_CURSOR_WORKER_MODE=cursor` and `SAY_TO_ME_URL=http://127.0.0.1:$PORT`.

**FAIL:** name is `stm-cur_…` (no port). Mode is `echo`. `SAY_TO_ME_URL` is 5411 or missing.

Do **not** `boo kill stm-${CUR}` or any `stm-<id>` without the port. Isolated stop is only `boo kill stm_${PORT}_${CUR}` (section 6).

### 4.5 Non-idle agent reply on the isolated session

```bash
say-to-me api --server "$ORIGIN" POST "/api/sessions/${CUR}/messages" \
  --data '{"author":"user","text":"Reply with only the word pong."}'

# Wait until an agent row exists. Do not treat can_continue as success by itself.
say-to-me api --server "$ORIGIN" GET "/api/sessions/${CUR}/jarvis-status?limit=20"
say-to-me api --server "$ORIGIN" GET "/api/sessions/${CUR}/messages"
```

**PASS:** some message has `author` `agent` and text contains `pong` (or another real model reply). That is a non-idle author=agent reply on the isolated session.

**FAIL:** `waitingState` is `can_continue` / idle and `messages` are only the user prompt. That is a **false idle**. Delivery `sent` without an agent row does not count.

**FAIL:** you posted the user message without `--server "$ORIGIN"` (it landed on live 5411).

---

## 5. Verify on isolated origin

Isolated sessions are in the isolated sqlite. They 404 on live 5411. Do this **before** stopping the isolated server.

```bash
# Isolated origin: session exists
say-to-me api --server "$ORIGIN" GET "/api/sessions/${CUR}"
say-to-me api --server "$ORIGIN" GET "/api/sessions/${CUR}/messages"

# Live 5411: same id must 404
say-to-me api --server http://127.0.0.1:5411 GET "/api/sessions/${CUR}" || true
```

**PASS:** `--server "$ORIGIN"` returns the session and the agent reply. `--server http://127.0.0.1:5411` returns 404 / `Session not found.`

**PASS:** Boo still shows `stm_${PORT}_${CUR}` (section 4.4) while the isolated server is up.

**FAIL:** you only checked live 5411. **FAIL:** you already stopped the isolated server, so you cannot tell sqlite isolation from “server is down.”

Voice from **this** live 5411 driver session (not the isolated Cursor worker):

```bash
say-to-me api --server http://127.0.0.1:5411 POST /api/sessions/<your-live-session-id>/messages \
  --data '{"author":"agent","text":"isolated cursor pass finished"}'
```

Do **not** point that call at `$ORIGIN`.

---

## 6. Stop

Only after section 5 (or after HTTP smoke if you are **not** doing a Cursor pass).

```bash
# Isolated Boo workers only
boo ls --json | jq -r --arg p "stm_${PORT}_" '.[] | select(.name|startswith($p)) | .name'
for n in $(boo ls --json | jq -r --arg p "stm_${PORT}_" '.[] | select(.name|startswith($p)) | .name'); do
  boo kill "$n"
done
# NEVER: boo kill stm-cur_…   or   boo kill stm-<id> without the port

cd "$WT"
vp exec astro dev stop

curl -sS "http://127.0.0.1:5411/api/health"
# PASS: live still {"ok":true}
```

Leave live 5411 / `say.local` alone.

---

## Isolated origin in agent prompts and Boo names

When this process is **not** live 5411 / `say.local`:

- Delivery prompts include: this session requires `say-to-me api --server http://127.0.0.1:$PORT` on every call. Do not use `say.local`. Do not export `SAY_TO_ME_URL` in a live 5411 shell.
- Boo worker names are `stm_<port>_<sessionId>` (example: `stm_5416_cur_abc`) instead of live `stm-<sessionId>`.
- If an isolated worker finds a machine-global legacy `stm-<sessionId>` worker, it refuses to start and logs the conflicting names. It never kills that legacy worker; stop only targets the isolated `stm_<port>_<sessionId>` name.

## What this is not

- **Not** `vp run check && vp run test`. That is the ship gate; it does not boot a second process.
- **Not** live 5411 / `say.local` smoke (e2e validator, e2e source, hold vs Force send). Those hit the shared instance.
- **Not** a committed `scripts/e2e-worktree.sh` yet. Until one exists, copy the env + `--server` pattern above.
- **Not** a Cursor pass: HTTP 200, queue smoke, echo workers, or `jarvis-status` idle with only the user message.
