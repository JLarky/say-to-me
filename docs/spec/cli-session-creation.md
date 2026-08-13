# CLI Session Creation

## Purpose

Describe how **new** external-CLI sessions (Claude, Codex, Cursor, Grok) are
created in Say To Me so that delivery can always **resume** a real provider
session, never invent a synthetic id that the provider does not know.

This is distinct from **import**, which attaches an existing provider session
by its real id.

## Goals

- After create succeeds, the Say session id encodes a **real** provider session
  id (or is otherwise mapped 1:1 to one) that the CLI can resume.
- Delivery for every provider is **resume-only**. No first-message bootstrap.
- Create fails loudly if the provider cannot allocate a real session (auth,
  usage limit, binary missing). Prefer no half-ready row that looks fine until
  first send.
- Import stays unchanged: real provider id → `prefix_<uuid>` with existing
  on-disk / remote state.

## Non-goals

- Changing OpenCode (`ses_*`) session creation.
- First-message or delivery-path bootstrap as the primary fix.
- Lazy “create on first message” for new CLI sessions.
- Cleaning up orphan provider threads the user never messages (follow-up).

## Identity model

| Path                     | Say session id                                                         | Provider thread / chat id                           |
| ------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------- |
| **Create (new)**         | `prefix_<realUuid>` where `realUuid` comes from the provider at create | Same bare uuid used for resume / local state        |
| **Import (existing)**    | `prefix_<existingUuid>` from the imported session                      | Same bare uuid; local/remote state already exists   |
| **Legacy broken create** | `prefix_<randomUuid>` with no provider state                           | First resume fails (`no rollout` / `404` / similar) |

Prefixes today:

- Claude `cc_`, Codex `cx_`, Cursor `cur_`, Grok `gr_`

Bare uuid is always the provider’s id (strip prefix). Delivery should pass that
bare id to resume APIs.

## Create flow (shared)

1. Client `POST /api/cli-sessions` with `{ provider, path, modelID }`.
2. Validate model and workspace path (exists, directory, writable).
3. Canonicalize cwd (resolve symlinks so provider state keys match).
4. **Bootstrap** (provider-specific): run a short headless CLI turn **without
   resume** so the provider allocates a real session and emits its id.
5. Build Say session id: `prefix_<realUuid>`.
6. Persist DB row: id, cwd, selected model/provider.
7. Return the session. Only then is the session ready for messages.

Shared bootstrap prompt (provider-agnostic, keep short):

```text
don't think, just reply okay
```

Defined as `EXTERNAL_CLI_BOOTSTRAP_PROMPT` so other providers reuse it.

## Provider matrix

| Provider   | Create bootstrap                                                                                       | Delivery                   | Status                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------- |
| **Codex**  | `codex exec … --json <prompt>` (no `resume`); parse `thread.started` / session id line                 | `codex exec resume <uuid>` | **Done** (create-time)                                                                            |
| **Grok**   | `grok --single <prompt> --output-format json --always-approve` (no `--resume`); parse JSON `sessionId` | `grok … --resume <uuid>`   | **Target of Grok create bootstrap**                                                               |
| **Claude** | Create currently allocates a local random uuid only                                                    | Resume-style delivery      | E2E create+send worked in smoke tests without bootstrap; re-verify if random ids ever fail resume |
| **Cursor** | Same as Claude today                                                                                   | Resume-style delivery      | Same as Claude                                                                                    |

When a provider needs bootstrap, the pattern is always:

- Bootstrap at **create**, not at first message.
- Session id = real provider id.
- Delivery remains resume-only.

## Failure behavior

- Bootstrap failure → create returns **5xx** with a clear error (stderr / JSON
  error / exit code). No “ready” session that cannot resume.
- Validation failure (path, missing model) → **400**.
- Do not retry permanent bootstrap failures as if they were transient delivery
  errors.

## Delivery invariant

For a CLI session created or imported successfully:

```text
resolveResumeId(sessionId) === stripPrefix(sessionId)
```

and that id must exist for the provider (local transcript/rollout and/or remote
registry). Delivery workers must not start a new provider session on send.

## Testing

- Unit: command args, parse real id from sample CLI output, create path with
  mocked bootstrap returns `prefix_<id>`.
- Unit: bootstrap failure surfaces from create (no silent random fallback for
  providers that require bootstrap).
- E2E smoke: create each provider; first user message `delivery=sent` and agent
  reply (or explicit failure for providers not yet bootstrapped).

## Follow-ups

- Apply the same create-time bootstrap to Claude/Cursor if smoke tests ever show
  random-id resume failures.
- Allow `gr_*` (and any other CLI prefixes) in session-card reference validation
  so agents can attach Grok session cards in voice replies.
- Optional idle cleanup for never-messaged bootstrapped provider sessions.
