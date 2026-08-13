# Model Reset Button

## Purpose

The **Reset** control on a session’s model picker re-syncs the Say To Me UI (and
stored session model row) to the model the **provider currently has for this
session**, not a global CLI/default config value.

That matches OpenCode today: if three Codex sessions run different models, or
an imported Claude session was changed outside Say To Me, Reset should surface
the real per-session model.

## Contract (all backends)

1. **Read** the model for **this session id** from the provider’s own state.
2. **Write** `opencodeSelectedModelProvider` / `opencodeSelectedModel` on the
   Say To Me session row.
3. **Refresh** the UI dropdown from that value.

Reset is **not**:

- “Global CLI default from `config.toml` / settings.json”
- “Default from `grok models` / provider list marked (default)”
- “Model chosen at create time” unless that is still what the provider has

Use cases: multi-session different models, import, external model changes.

## OpenCode (reference implementation)

`POST /api/sessions/:sessionId/opencode-model/reset`

1. `getOpenCodeSessionModel(sessionId)` — OpenCode API for that session
2. `updateSessionOpenCodeModel(...)`
3. Return updated session payload for the UI

## CLI backends

### Shared UI requirement

For non-OpenCode session ids, Reset must call:

`POST /api/sessions/:sessionId/model/reset`

not only `GET /api/sessions/:sessionId/current-model`.

`GET …/current-model` is for **reading** the provider’s current model for the
session (same source as reset step 1). Reset must still **persist** via the
POST reset endpoint (or an equivalent that writes the session row).

### Per-session source (required)

| Provider | Session-scoped source (preferred)                                                                             | Global fallback (not for Reset)       |
| -------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Grok** | `~/.grok/sessions/<cwdEnc>/<uuid>/summary.json` → `current_model_id` (else `signals.json` → `primaryModelId`) | `~/.grok/config.toml` / `grok models` |
| Codex    | TBD (session meta / transcript)                                                                               | `~/.codex/config.toml`                |
| Claude   | TBD (session local state)                                                                                     | `~/.claude/settings.json`             |
| Cursor   | TBD                                                                                                           | `~/.cursor/cli-config.json`           |

**Grok is implemented first** because e2e showed wrong Reset values when only
global config was used.

### API behavior

`POST /api/sessions/:sessionId/model/reset`

- Detect backend from session id prefix.
- OpenCode: same as OpenCode reset (session model from OpenCode).
- Grok: read session-scoped model from Grok session dir; fail if unavailable.
- Other CLI (until implemented): may still use global default; treat as known gap.
- On success: update Say session model fields; return `{ providerID, modelID }`.

`GET /api/sessions/:sessionId/current-model`

- Same **read** source as reset for that backend (Grok: per-session first).
- Does not write the DB by itself.

## Failure

- If the provider has no session state (never bootstrapped / missing files),
  Reset should fail with a clear error, not silently invent a global default.
- Transient CLI failures → 502-style error; do not partially update UI.

## Testing

- Unit: parse Grok `summary.json` / `signals.json` for model id.
- Unit/API: Grok reset writes session row from session file, not config.toml.
- UI: non-OpenCode Reset issues `POST …/model/reset`.
- Manual: Grok session on `grok-4.5` while config default is
  `grok-composer-2.5-fast` → Reset shows `grok-4.5`.

## Follow-ups

- Session-scoped model readers for Codex, Claude, Cursor.
- Align any remaining global-only paths with this contract.
- Optional: return full session payload from CLI reset (parity with OpenCode UI).
