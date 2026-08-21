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
- **Break clean from timers:** drop `/api/jarvis-timers`; ship `/api/routines`; update
  all in-repo UI/callers. No permanent facade.
- When **A waits for B**, the routine is visible in the UI of **both** A and B (owner
  and target). Either side can understand the wait; cancel removes it so A is no
  longer waiting.
- Agents correlate fan-out (A→B and A→C) without parsing prose when a source relay
  message exists: completion cites **`sourceMessageId`**.
- Each phase ships alone.

## Decided sequencing (product)

| Phase | Ship                                                                                                                                                            | Main user outcome                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **1** | `routines` table + `/api/routines`; migrate `jarvis_timers`; **remove** `/api/jarvis-timers`; update timer UI to routines shapes                                | Schedule routines work end-to-end under the new name/API |
| **2** | `session_idle` routines (relay notify-on-completion creates them); structured completion; **cancel/delete wait**; list on **both** owner and target session UIs | A can cancel “wait for B”; B sees that A is waiting      |
| **3** | Manual “wait until B is idle” create UI (no relay required)                                                                                                     | Humans add waits without forwarding a message first      |

## Non-goals (for this spec’s first landings)

- Full roadmap **Task / Run / Artifact** tables (routines may gain an optional
  `taskId` later; they do not require Tasks first).
- Effect delivery lease heartbeat (unused production path; separate concern).
- Replacing messages as the conversation log.
- Merging everything into `jarvis_timers` rows with nullable `dueAt`.
- Keeping `/api/jarvis-timers` as a compatibility facade.

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
      /**
       * Source relay message id when the wait came from a relay. Null for
       * manually created waits (Phase 3). When present, completion must echo it
       * for fan-out correlation.
       */
      sourceMessageId: number | null;
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
      // Create bodies omit the result; the worker fills a structured completion:
      // { kind: "watcher_completed", routineId, sourceMessageId | null,
      //   targetSessionId, targetMessageId | null, reason }
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
  and by `owner_session_id`

### Visibility (both sessions)

A routine appears in session lists for every session that is a **party** to it:

| Trigger        | Visible on                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `schedule`     | `ownerSessionId` only (same as today’s timer → session)                                        |
| `session_idle` | **both** `ownerSessionId` (A, the waiter) **and** `trigger.targetSessionId` (B, the waited-on) |

`GET /api/routines?sessionId=X` returns routines where `ownerSessionId = X` **or**
(for `session_idle`) `trigger.targetSessionId = X`. The UI on B should label the
row as “A is waiting for this session to be idle” (or similar); on A as “waiting
for B”. Cancel/delete is allowed from either party’s UI in Phase 2 (deleting the
routine is the product action that stops the wait).

### Correlation rule (idle watch)

For `trigger.kind === "session_idle"`:

- When created by relay: store `sourceMessageId` (the source row with
  `forwardRole: "source"`). A→B and A→C ⇒ two routines. Fan-out is free.
- When created manually (Phase 3): `sourceMessageId` is null; correlation key is
  `routine.id`.
- The completion notification (and any structured payload) **must** carry
  `routineId` and, when set, `sourceMessageId`, so the owner matches without
  parsing `text`.

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

### Phase 1 — Routines replace timers (break clean)

1. Add `routines` table.
2. Migrate every `jarvis_timers` row into a `schedule` routine.
3. Ship `/api/routines` (CRUD + pause/resume/cancel/trigger).
4. **Remove** `/api/jarvis-timers` (and related actions routes). Update every
   in-repo caller and the timer UI to the new shapes.
5. Drop or empty `jarvis_timers` after migration (implementing PR chooses migrate-
   then-drop vs rename-in-place).

**Done when:** no remaining references to `/api/jarvis-timers` in app code; schedule
routines create/list/pause/cancel/fire with the same user-visible behavior timers
had; UI uses routines.

### Phase 2 — session_idle waits (relay-created) + cancel + dual UI

Main goal: **cancel wait** so A is no longer notified when B goes idle.

1. On relay with notify-on-completion, create a `session_idle` routine in the same
   transaction as the source/target messages (`sourceMessageId` set,
   `ownerSessionId` = A, `targetSessionId` = B).
2. Routine is the source of truth; retire reliance on in-memory watch maps.
   Message `completion_watch_*` columns may be dual-written briefly, then dropped.
3. On fire `notify_owner`: speakable `text` + structured payload including
   `routineId` and `sourceMessageId` when set; mark routine terminal; idempotent
   restart / duplicate idle.
4. Session routines UI lists **schedule and session_idle**, and for idle waits
   shows the row on **both A and B**.
5. **DELETE / cancel** removes the wait: no later idle notification.

**Done when:** fan-out A→B and A→C yields two routines/completions with correct
`sourceMessageId`; cancel from A or B prevents notify; both session UIs show the
active wait; delivery failure ⇒ `reason: "failed"` without hanging.

### Phase 3 — Manual waits (new UI)

Main goal: **add a wait without a relay** — A will be notified when B is idle.

1. UI to create `session_idle` with `sourceMessageId: null`, picking target B.
2. Same dual visibility and cancel behavior as Phase 2.
3. Correlation for clients: `routine.id`.

**Done when:** a human can create/cancel a wait from the UI with no forward
message involved.

### Phase 4 — Expand (later)

- More triggers: `delivery_failed`, webhook, `pr_merged`, …
- More actions: open PR comment, chain another routine, …
- Optional `taskId` linking to roadmap Task/Run entities.

## API sketch (Phase 1+)

```http
GET    /api/routines?sessionId=&status=&triggerKind=
POST   /api/routines
GET    /api/routines/:id
PATCH  /api/routines/:id
POST   /api/routines/:id/actions   # pause | resume | cancel | trigger
DELETE /api/routines/:id
```

`sessionId` filter: owner **or** idle-target (see Visibility). Do not only filter
on `ownerSessionId`, or B will never see waits aimed at it.

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
  "action": { "kind": "notify_owner" }
}
```

```json
{
  "ownerSessionId": "cur_…",
  "title": "Ping me when B is free",
  "trigger": {
    "kind": "session_idle",
    "targetSessionId": "cx_…",
    "sourceMessageId": null,
    "afterWorkSeen": true
  },
  "action": { "kind": "notify_owner" }
}
```

Relay path may create the idle routine internally (Phase 2). Manual create uses
`POST /api/routines` (Phase 3 UI).

Structured completion on the notification message / routine row should include at
least: `routineId`, `targetSessionId`, `reason`, and `sourceMessageId` when non-null.
(The `action.event` sketch in the Model section is the shape of that payload; the
create body need not pre-seed `reason`.)

## Decision: where structured completion lives

**Prefer both:**

1. Persist structured completion on the **routine** row (status + last event fields /
   action snapshot) — source of truth for UI and API.
2. Also put a compact structured payload on the **notification message** so agents
   already consuming the message stream do not need a second poll. Exact field name
   (`systemEvent` vs `routineEvent`) is an implementation detail; the contract is
   “machine field, not prose.”

Keep short speakable `text` for humans and TTS (for example `Session is now idle.`);
machine correlation lives on `routineEvent` / routine action result plus `sessionRefs`.
Legacy `<say-to-me-system>… is idle now</say-to-me-system>` tags remain recognized as
fallback-only in detectors.

## Failure cases

| Case                                | Behavior                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| Schedule due, deliver fails         | routine `failed` or retry per existing timer policy; surface `lastError`     |
| Target never leaves idle            | complete only after idle **after** `work_seen` (today’s semantics)           |
| Target delivery fails before work   | `notify_owner` with `reason: "failed"`; do not hang forever                  |
| Duplicate idle / double fire        | idempotent completion keyed by `routineId` (and `sourceMessageId` when set)  |
| Process restart                     | resume `active` schedule by `nextFireAt`; resume `active` idle-watch from DB |
| Cancel/delete from A or B mid-watch | routine `cancelled`; no later idle notify                                    |
| Relay without notify                | no idle routine created                                                      |

## Tests (minimum)

**Phase 1**

- Schedule CRUD/actions via `/api/routines` match former timer behavior.
- Worker fires due schedule routines and writes `lastMessageId`.
- Migration of existing `jarvis_timers` fixtures; `/api/jarvis-timers` gone.

**Phase 2**

- Relay with notify creates `session_idle` routine; visible via
  `?sessionId=` for **both** A and B.
- Idle after work_seen notifies A with structured `routineId` / `sourceMessageId`.
- Fan-out: two targets ⇒ two routines ⇒ two completions; no cross-talk.
- **Cancel/delete** ⇒ no notification.
- Delivery failure ⇒ `reason: "failed"`.
- Restart mid-watch still notifies.

**Phase 3**

- Manual create with `sourceMessageId: null` works; cancel works; dual visibility.

## Open questions

1. **Interval schedule status:** after a successful interval fire, status stays
   `active` with bumped `nextFireAt` (like today) vs brief `fired` — prefer mirror
   today’s timer worker.
2. **Message field name** for structured notify: bikeshed in Phase 2 PR; do not
   block Phase 1.
3. **Who may cancel on B:** any viewer of B’s session UI, or only if they can
   mutate that session? Default: same auth as other session controls on B.
4. **Migrate vs rename table:** copy `jarvis_timers` → `routines` then drop, or
   alter in place — implementing PR chooses; behavior is what matters.

## Related

- Closed #19 / #20 via #23 / #24 (wait + relay links) — prerequisites for trustworthy
  orchestration, already done.
- Closed #21 — superseded by this spec’s Phase 2 structured notify.
- `docs/roadmap.md` — Task/Run/Artifact remain a separate axis; optional `taskId` on
  routines later.
- Current timer schema: `server/db/drizzle-schema.ts` (`jarvisTimers`).
- Current watch fields: `messages.completion_watch_*` / `completion_source_*`.
