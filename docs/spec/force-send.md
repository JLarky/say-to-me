# Force Send

## Purpose

Force send lets a user deliver a message to an OpenCode-backed session **even
while that session is still busy**, instead of waiting for it to become idle.

It exists for the case where the user deliberately wants to interrupt or add to
work already in progress — for example, to redirect the agent or answer a
question — rather than letting the message sit until the current work finishes.

## Normal send vs. force send

When a user message targets an OpenCode session, delivery depends on the
session's current state:

- **Normal send.** If the session is idle, the message is delivered right away.
  If the session is busy, the message is held and delivered automatically once
  the session becomes idle. Until then it shows a waiting state ("waiting for
  OpenCode to be idle").
- **Force send.** The message is delivered immediately regardless of whether the
  session is idle or busy. The wait-for-idle hold is skipped.

Force send only changes the _timing_ gate (wait-for-idle). It does not change
anything else about how the message is delivered.

## Triggering a force send

Force send is always an explicit user action; a message is never force-sent on
its own. It can be triggered:

- From the composer when sending a new message (the send control offers a
  force variant, e.g. a keyboard modifier or a press-and-hold gesture).
- From an already-queued message that is waiting for the session to become
  idle, via a per-message "Force send" action.

## Durability

Force send does not trade away delivery guarantees. A force-sent message is
still durable: it is queued, retried on transient failure, and survives a
restart, exactly like a normal send. Force only removes the wait-for-idle gate;
the delivery, retry, and failure handling are unchanged.

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
  reporting — only the wait-for-idle hold.
- Force send does not reorder, merge, or drop other queued messages for the
  session; it only affects the forced message's own timing.
