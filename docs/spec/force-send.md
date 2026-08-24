# Force Send

## Purpose

Force send lets a user deliver a message to an agent session **even while that
session is still busy**, instead of waiting for it to become idle.

It exists for the case where the user deliberately wants to interrupt or add to
work already in progress — for example, to redirect the agent or answer a
question — rather than letting the message sit until the current work finishes.

## Normal send vs. force send

When a user message targets a session, delivery depends on the session's current
state:

- **Normal send.** If the session is idle, the message is delivered right away.
  If the session is busy, the message is held and delivered automatically once
  the session becomes idle. Until then it shows a waiting state ("waiting for
  <provider> to be idle").
- **Force send.** The message is delivered immediately regardless of whether the
  session is idle or busy. On OpenCode this skips only the wait-for-idle hold.
  On external CLI sessions it does more — see below.

This applies to OpenCode sessions and to external CLI sessions (Cursor, Claude,
Codex, Grok):

- **OpenCode busy** means the live OpenCode session reports it is working.
  Force send there stays inject-while-busy: the prompt is handed to the live
  session without stopping anything, because OpenCode accepts input mid-turn.
- **CLI busy** means a prompt was handed to a provider process and its turn has
  not been observed to end yet. CLI delivery claims hold while another prompt's
  turn is open, so a queued CLI row genuinely waits.

## CLI force send interrupts: Stop, then deliver

A running CLI provider cannot accept a second prompt; handing one over anyway
just queues behind the running turn (the PR 42 behavior — timing-only force —
which let "forced" replies arrive only after the old work finished). So on
Cursor, Claude, Codex, and Grok, force send is **Stop-then-deliver**:

1. **Stop first.** Whatever delivery currently holds the session goes through
   the exact flow behind the Stop endpoints ([cli-provider-stop.md](./cli-provider-stop.md)):
   its job is cancelled with `Stopped by user.`, the boo worker is killed, and
   the underlying CLI process dies with it. The killed turn is fenced like any
   stopped delivery: it must never post a later agent reply.
2. **Then deliver.** The forced message enqueues with its force flag set, so it
   claims immediately on the fresh worker — while the old sleep would still
   have been running.

Only work that actually holds the provider is stopped. A force send neither
cancels other merely-queued messages nor reorders them; the forced job simply
claims ahead of them. Plain Stop keeps cancelling every active job, queued ones
included — its semantics are unchanged, just reused.

Without the force flag nothing changes: a normal send still waits for the open
turn to close (the wait-for-idle hold).

Both force entry points behave identically — the composer's force variant when
sending a new message, and the per-message Force send action on a queued
message. The per-message action on a failed message is labeled Retry; if the
session is meanwhile busy with another live turn, that forced handover also
stops the holding turn first rather than injecting mid-run.

## Triggering a force send

Force send is always an explicit user action; a message is never force-sent on
its own. It can be triggered:

- From the composer when sending a new message (the send control offers a
  force variant, e.g. a keyboard modifier or a press-and-hold gesture). This
  works for every delivery-backed provider.
- From an already-queued message that is waiting for the session to become
  idle, via a per-message "Force send" action.

Both paths reuse the retry-delivery endpoint with its force flag set; on a
failed message that endpoint is simply Retry, not Force send.

## Durability

Force send does not trade away delivery guarantees. A force-sent message is
still durable: it is queued, retried on transient failure, and survives a
restart, exactly like a normal send. Force removes the wait-for-idle gate (and
on CLI backends, stops the holding turn first); the delivery, retry, and
failure handling are unchanged.

A force send that cannot be delivered (a genuine delivery failure, not merely a
busy session) follows the same retry-and-surface-error path as any other
delivery.

## Status semantics

- A normal message to a busy session is reported as queued / waiting for idle
  and offers a force-send action.
- A force send is reported as delivered (sent) once it reaches the session, the
  same as any successful delivery.
- A message that is waiting for idle has not been delivered yet; force send is
  the way to deliver it without waiting.

## Non-goals

- Force send is not a way to bypass delivery durability, retries, or failure
  reporting — only the wait-for-idle gate (plus the CLI stop-first interrupt).
- Force send does not reorder, merge, or drop other queued messages for the
  session; it only affects the forced message's own timing.
- Force send does not weaken Stop: it reuses the Stop flow for the holding
  delivery and leaves Stop's own behavior untouched.
