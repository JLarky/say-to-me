# Spec: Routines

## Why

Say To Me already has two “wake me when X” systems that do not know about each other:

1. **Jarvis timers** (`jarvis_timers`) — clock-based. A human (or agent) schedules
   `dueAt` / `intervalMs`; when due, the worker delivers a prompt message into a
   target session. First-class API and UI (`/jarvis`, session timer pages), pause /
   resume / cancel.
2. **Completion watch** — event-based. A relay with notify-on-completion arms fields
   on the target message (`completion_watch_status`, `completion_source_message_id`,
   …). When the target becomes idle after work was seen, the server posts a
   `<say-to-me-system>… is idle now</say-to-me-system>` message back to the source.
   No shared list UI, no pause/cancel surface, and agents must parse prose to know
   which relay finished.

Both are durable automation rules. The difference is only the **trigger**. Treating
timers as the product name makes schedule feel primary and hides idle-watch from
users. Stuffing idle-watch into `jarvis_timers` with a nullable `dueAt` teaches the
wrong model and forces a pile of XOR columns.

Grok-style **routines** are the right umbrella: a durable rule with a polymorphic
trigger and a separate action. Schedule is one trigger among many; session-idle
after a relay is another. Later triggers (delivery failed, webhook, PR merged) plug
into the same list, cancel/pause, and restart recovery.

Issue #21 (structured `systemEvent` on messages as a one-off) was closed in favor of
this plan: do not ship a throwaway message field if routines are the destination.
Machine-readable completion is still a hard requirement; it moves into the routine
action result rather than a standalone patch.

## Goals

- One durable **Routine** entity: identity, owner, status, trigger, action.
- **Schedule** and **session_idle** as the first two triggers; more later without
  renaming the product.
- Humans see one “Waiting on…” / Routines UI (due at 3pm alongside waiting for
  `cx_…` idle after relay `#1867`).
- Agents correlate fan-out (A→B and A→C) without parsing prose: completion cites the
  **source relay message id**.
- Each implementation phase ships alone; no big-bang cutover from timers.
- Existing timer API remains usable (facade or alias) through migration.

## Non-goals (for this spec’s first landings)

- Full roadmap **Task / Run / Artifact** tables (routines may gain an optional
  `taskId` later; they do not require Tasks first).
- Effect delivery lease heartbeat (unused production path; separate concern).
- Replacing messages as the conversation log.
- Merging everything into `jarvis_timers` rows with nullable `dueAt`.

## Model

```ts
type RoutineStatus =
  | "active"
  | "paused"
  | "firing"
  | "fired" // terminal one-shot success (or last successful fire before interval reschedule)
  | "cancelled"
  | "failed";

type RoutineTrigger =
  | {
      kind: "schedule";
      dueAt: number; // ms epoch; mirrors today’s timer dueAt for one-shot / first fire
      intervalMs: number | null;
      nextFireAt: number; // worker scan key; mirrors jarvis_timers.nextFireAt
    }
  | {
      kind: "session_idle";
      targetSessionId: string;
      /** Source relay message id — load-bearing correlation for fan-out. */
      sourceMessageId: number;
      /** Keep today’s semantics: only complete after idle *after* work was observed. */
      afterWorkSeen: true;
    };

type RoutineAction =
  | {
      kind: "deliver_prompt";
      title: string;
      message: string; // prompt text delivered into ownerSessionId (today: timer sessionId)
    }
  | {
      kind: "notify_owner";
      /**
       * Structured result written onto the notification message (and/or returned on
       * the routine row). Callers must not need to regex `text`.
       */
      event: {
        kind: "watcher_completed";
        sourceMessageId: number;
        targetSessionId: string;
        targetMessageId: number | null;
        reason: "session_idle" | "cancelled" | "failed" | "timed_out" | "superseded";
      };
    };

type Routine = {
  id: number;
  /** Session that owns / manages the routine and receives notify_owner results. */
  ownerSessionId: string;
  status: RoutineStatus;
  trigger: RoutineTrigger;
  action: RoutineAction;
  /** Optional human label (timer title today). */
  title: string | null;
  lastFiredAt: number | null;
  lastMessageId: number | null; // message produced by the last successful action
  lastError: string | null;
  lockedAt: number | null;
  lockedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
```

Storage may use JSON columns for `trigger` / `action` or typed columns with a
`trigger_kind` discriminator. Either is fine if ArkType validates at the trust
boundary and indexes support worker scans:

- schedule: `(status, next_fire_at)` (same role as `jarvis_timers_due_idx`)
- session_idle: `(status, target_session_id)` plus lookup by `source_message_id`

### Correlation rule (idle watch)

For `trigger.kind === "session_idle"`:

- **Watcher id = `sourceMessageId`** (the relay source row with
  `forwardRole: "source"`).
- A→B and A→C are two relays ⇒ two source messages ⇒ two routines. Fan-out is free.
- The completion notification (and any structured payload) **must** carry
  `sourceMessageId` so the owner matches without parsing `text`.

### Lifecycle

```
active ⇄ paused
active → firing → active     (interval schedule reschedule)
active → firing → fired      (one-shot schedule or idle notify success)
active → cancelled | failed
```

Lease fields (`lockedAt` / `lockedBy`) follow the timer worker pattern so only one
worker fires a due routine.

## Mapping from today

| Today                                      | Routine shape                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `jarvis_timers` row                        | `trigger: schedule`, `action: deliver_prompt`, `ownerSessionId = sessionId`                                                        |
| Relay + `completionWatchStatus = watching` | create routine: `trigger: session_idle` with `sourceMessageId` / `targetSessionId`, `action: notify_owner`                         |
| Idle system message to source              | action result: keep speakable `text`; attach structured `event` on the message **or** only on the routine row (see Decision below) |
| In-memory maps in `notifications.ts`       | not source of truth; DB routine (and existing message watch columns during migration)                                              |

## Phased delivery

### Phase A — Spec only (this document)

Land the model and decisions. No schema yet.

### Phase B — Schema + migrate timers

1. Add `routines` table (name bikeshed-able; API can say “routines”).
2. Migrate every `jarvis_timers` row into a schedule routine.
3. Keep `GET/POST/PATCH /api/jarvis-timers` and actions as a **compatibility facade**
   over routines filtered to `trigger.kind === "schedule"`, **or** add
   `/api/routines` and deprecate timers in OpenAPI with a documented sunset.
4. Timer UI reads the facade or routines; behavior unchanged for users.
5. Dual-write or single-write with facade — pick one in the implementing PR; prefer
   single-write behind facade to avoid drift.

**Done when:** existing timer tests pass against the facade; creating a timer creates
a routine row; pause/cancel/trigger still work.

### Phase C — session_idle routines + structured notify

1. On relay with notify-on-completion, create a `session_idle` routine (in the same
   transaction as the source/target messages).
2. Completion worker watches routine rows (and/or continues to use message
   `completion_watch_*` columns as a cache that must stay consistent with the
   routine). Prefer routine as source of truth once Phase C lands.
3. When firing `notify_owner`:
   - insert the owner-facing notification message with human `text` (TTS-safe);
   - attach structured completion (`event` above) so agents do not parse prose;
   - set routine status terminal (`fired` / `failed` / …);
   - idempotent on restart / duplicate idle (key completion
     `clientMessageId` off `sourceMessageId`).
4. UI: one Routines list showing schedule and session_idle entries; pause/cancel
   both.

**Done when:** fan-out test (A→B and A→C) yields two completions each citing the
correct `sourceMessageId`; delivery failure yields `reason: "failed"` without
hanging; process restart mid-watch still notifies; UI can cancel an idle-watch.

### Phase D — Expand (later)

- More triggers: `delivery_failed`, webhook, `pr_merged`, …
- More actions: open PR comment, chain another routine, …
- Optional `taskId` linking to roadmap Task/Run entities.
- Drop timer facade when callers have moved.

## API sketch (Phase B+)

```http
GET    /api/routines?ownerSessionId=&status=&triggerKind=
POST   /api/routines
GET    /api/routines/:id
PATCH  /api/routines/:id
POST   /api/routines/:id/actions   # pause | resume | cancel | trigger
DELETE /api/routines/:id
```

Create body (examples):

```json
{
  "ownerSessionId": "cur_…",
  "title": "Check in",
  "trigger": { "kind": "schedule", "dueAt": 1781880000000, "intervalMs": null },
  "action": { "kind": "deliver_prompt", "title": "Check in", "message": "Please continue." }
}
```

```json
{
  "ownerSessionId": "cur_…",
  "trigger": {
    "kind": "session_idle",
    "targetSessionId": "cx_…",
    "sourceMessageId": 1867,
    "afterWorkSeen": true
  },
  "action": {
    "kind": "notify_owner",
    "event": {
      "kind": "watcher_completed",
      "sourceMessageId": 1867,
      "targetSessionId": "cx_…",
      "targetMessageId": 1868,
      "reason": "session_idle"
    }
  }
}
```

Relay path may create the idle routine internally rather than requiring a separate
POST from clients.

## Decision: where structured completion lives

**Prefer both:**

1. Persist structured completion on the **routine** row (status + last event fields /
   action snapshot) — source of truth for UI and API.
2. Also put a compact structured payload on the **notification message** so agents
   already consuming the message stream do not need a second poll. Exact field name
   (`systemEvent` vs `routineEvent`) is an implementation detail; the contract is
   “machine field, not prose.”

Keep sentinel `text` for humans and old clients through Phase C; regex helpers in
`src/message-delivery.ts` remain fallback-only.

## Failure cases

| Case                              | Behavior                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Schedule due, deliver fails       | routine `failed` or retry per existing timer policy; surface `lastError`     |
| Target never leaves idle          | complete only after idle **after** `work_seen` (today’s semantics)           |
| Target delivery fails before work | `notify_owner` with `reason: "failed"`; do not hang forever                  |
| Duplicate idle / double fire      | idempotent completion keyed by `sourceMessageId`                             |
| Process restart                   | resume `active` schedule by `nextFireAt`; resume `active` idle-watch from DB |
| Owner cancels mid-watch           | routine `cancelled`; no later idle notify                                    |
| Relay without notify              | no idle routine created                                                      |

## Tests (minimum)

**Phase B**

- Timer CRUD/actions via facade create/update routine rows correctly.
- Worker fires due schedule routines and writes `lastMessageId`.
- Migration of existing `jarvis_timers` fixtures.

**Phase C**

- Relay with notify creates `session_idle` routine with correct ids.
- Idle after work_seen fires `notify_owner` with matching `sourceMessageId`.
- Fan-out: two targets ⇒ two routines ⇒ two completions; no cross-talk.
- Delivery failure ⇒ `reason: "failed"`.
- Restart mid-watch still notifies.
- Cancel routine ⇒ no notification.
- TTS/`text` still present; agents can ignore `text` when structured field exists.

## Open questions

1. **Facade vs dual API:** keep `/api/jarvis-timers` forever as alias, or sunset after
   one release? Default: facade until Phase D.
2. **Interval schedule status:** after a successful interval fire, status stays
   `active` with bumped `nextFireAt` (like today) vs brief `fired` — prefer mirror
   today’s timer worker.
3. **Message field name** for structured notify: bikeshed in Phase C PR; do not block
   Phase B.
4. **Automatic routine creation:** only on relay notify, or also expose “wait until
   this session is idle” from the UI without a relay? Phase C = relay only; UI-only
   wait can be Phase D.

## Related

- Closed #19 / #20 via #23 / #24 (wait + relay links) — prerequisites for trustworthy
  orchestration, already done.
- Closed #21 — superseded by this spec’s Phase C structured notify.
- `docs/roadmap.md` — Task/Run/Artifact remain a separate axis; optional `taskId` on
  routines later.
- Current timer schema: `server/db/drizzle-schema.ts` (`jarvisTimers`).
- Current watch fields: `messages.completion_watch_*` / `completion_source_*`.
