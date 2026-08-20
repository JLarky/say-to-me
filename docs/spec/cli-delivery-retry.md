# Spec: user-facing retry for external CLI delivery

## Why

`docs/spec/delivery-dispatch-marker.md` made delivery honest: once a prompt has been
handed to a provider, the queue never silently re-sends it. The marker
(`prompt_dispatched_at`) is set before spawn and never cleared, so a job whose outcome
is unknown stops instead of prompting the agent twice.

That trade is only acceptable if a human can override it. Right now they cannot:

1. **The retry endpoint is OpenCode-only.** `POST /api/messages/:id/retry-opencode`
   calls `validateSessionId`, which is `OPENCODE_ID`-only (`server/session-id.ts:59`),
   so every Cursor/Claude/Codex/Grok message gets `400 Message is not in an
OpenCode-backed session.`
2. **The UI hides the button for CLI providers.** `DeliveryStatus` in
   `src/components/MessageRow.tsx` gates both `Retry` and `Force send` on the provider
   being OpenCode.
3. **Re-enqueue cannot revive a dispatched job.** `enqueueDeliveryJob`'s revive CAS
   requires `promptDispatchedAt IS NULL` (`server/external-cli/durable-delivery.ts:282`),
   and `reclaimExpiredLeases` only touches `status = "running"` rows. A dispatched job
   that went terminal is therefore unreachable by every existing code path.

So the marker currently converts "we might double-send" into "this message is stuck
forever, with no button". That is a worse failure for the user, and it is the reason
this follow-up is a prerequisite rather than a nice-to-have.

The second half of the change follows from the same reasoning. `cli_unconfirmed` was
introduced as a distinct status so we would not claim a delivery failed when it may
have landed. But a status the user cannot act on is not more honest, it is just more
confusing: the two states the user cares about are "it's on its way" and "it needs your
attention". Uncertainty belongs in the _explanation_, not in a separate terminal state.
Collapsing `cli_unconfirmed` into `failed` while keeping the explanatory error text
gives the user one actionable state and preserves the truth about what we know.

## Scope

Two changes that must land together, because either alone is a regression:
collapsing the status without a retry button removes information, and adding the button
without collapsing leaves a state the button does not render for.

### 1. Generic retry on the external-CLI queue

Add a user-facing retry to the factory in `server/external-cli/durable-delivery.ts`,
modelled on `retryOpenCodeDeliveryJob` (`server/opencode/durable-delivery.ts:210`):

```ts
function retryDeliveryJob(messageId: number, options?: { force?: boolean }): TJob | null;
```

It must, in one transaction:

- reset `status` to `"pending"`, `nextAttemptAt` to now, clear `lockedAt`, `lockedBy`,
  and `lastError`;
- **clear `promptDispatchedAt`** — this is the whole point. The marker means "the queue
  must not decide to re-send on its own". An explicit human retry is a different
  assertion: _I checked the session, it did not land, send it again._ Without this the
  function is a no-op for exactly the jobs that need it;
- call `updateOpencodeDelivery(messageId, "queued", null, null)` so the row's delivery
  status matches the job;
- ensure the boo worker exists for the session (`config.ensureBooWorker`), the way
  `enqueueDeliveryJob` does at line 302. A reset job with no worker polling that
  session sits `pending` forever.

Export it per provider (`retryCursorDeliveryJob`, `retryClaudeDeliveryJob`,
`retryCodexDeliveryJob`, `retryGrokDeliveryJob`) alongside the existing
`retry*DeliveryJobFromWorker` exports. Note these are different operations and should
not be conflated: the `FromWorker` variant is lease-scoped and policy-driven, this one
is an unconditional human override.

### 2. Route that dispatches on backend

`retryOpenCodeDeliveryEffect` in `server/api-routes/message-controls.ts` becomes
backend-aware. Resolve the target session the same way it does today (parent's
`attachedSessionId || sessionId`, else the reply's own `sessionId`), then switch on
`detectSessionBackend(targetSessionId)`:

- `opencode` → existing path, unchanged;
- `cursor` / `claude` / `codex` / `grok` → the matching `retry*DeliveryJob`, falling
  back to `enqueue*DeliveryJob` with `force: true` when no job row exists (mirroring
  the OpenCode branch);
- anything else → keep a 400, but with an accurate message. The current wording claims
  the session is not OpenCode-backed, which will read as nonsense on a `t3_` or voice
  session.

Replace the `validateSessionId` guard, which is the actual source of the 400s.

**Decision needed:** the endpoint is `POST /api/messages/:id/retry-opencode` and is
published in the OpenAPI surface, so agents may call it. Prefer adding
`POST /api/messages/:id/retry-delivery` as the generic endpoint and leaving
`retry-opencode` as a thin deprecated alias, rather than silently changing what the
OpenCode-named path does.

### 3. Collapse `cli_unconfirmed` into `failed`

- `afterDeliveryFailure` (`server/external-cli/durable-delivery.ts:690`) writes
  `"failed"` for both outcomes. Keep passing the distinct `config.unconfirmedMessage`
  text so `opencodeDeliveryError` still explains that the prompt reached the CLI and
  the result is unknown.
- Keep `DeliveryTerminalOutcome` if it still earns its place (it selects the error
  text and the workflow's failure branch); drop it if collapsing makes it vestigial.
  Do not keep a two-valued type that both branches now treat identically.
- Remove `cli_unconfirmed` from `deliveryStatuses` and `deliveryStatusLabel` in
  `src/message-delivery.ts`, and from `packages/session-utils/src/waiting-state-classify.ts`
  and `server/messages.ts`.
- The `unconfirmedMessage` text should now read as a failure the user can retry, since
  that is how it will be labelled. Something like "Couldn't confirm this reached
  Cursor — check the session before retrying" beats the current phrasing under a
  `failed` badge.
- **Existing rows:** the local SQLite may already hold `cli_unconfirmed`. The UI's
  `deliveryStatusSet.has()` guard degrades those to `"${provider} cli_unconfirmed"`,
  which is ugly but not broken. Either add a migration rewriting them to `failed`, or
  deliberately accept the degradation — but say which, in the PR body.

### 4. UI

In `DeliveryStatus` (`src/components/MessageRow.tsx`), render `Retry` on `failed` for
every provider. `Force send` on `queued` is a separate question: it exists because
OpenCode delivery waits for the session to be idle. Only wire it for CLI providers if
their queued state has the same meaning; otherwise leave it OpenCode-only and say so.

Rename the `onRetryOpenCodeDelivery` prop and the `retryOpenCodeDelivery` handler in
`SessionPage.tsx` to drop the OpenCode-specific name, along with the error string
"Unable to retry OpenCode delivery."

## Tests

- The retry clears `promptDispatchedAt` and a previously-dispatched terminal job
  becomes claimable again. This is the regression that matters most; assert on the
  job row, not just the endpoint's 200.
- Retry works for all four CLI backends via the route (table-driven, like
  `server/external-cli/delivery-dispatch-worker-providers.test.ts`).
- A dispatched-then-lost job surfaces as `failed` with the unconfirmed explanation,
  and the UI renders a Retry button for it.
- Re-enqueue (as opposed to explicit retry) still refuses to revive a dispatched job.
  Keep the existing dispatch-marker tests passing unchanged — if one needs editing,
  that is a signal the marker's guarantee was weakened somewhere it shouldn't be.
- Unrelated backends (`t3_`, voice) still get a 400 from the retry route.

## Out of scope

- The missing lease heartbeat in `packages/external-cli-delivery/src/workflow.ts`
  (documented in PR #18). Tracked separately; it affects the unused Effect path.
- Confirming delivery via transcript inspection using `dispatch_key`.
- Unifying the four provider spawn implementations.
