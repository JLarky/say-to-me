# Message History and Pinning

## Purpose

Say To Me keeps a bounded history for each session so a long-running session
does not grow without limit. Important messages can be pinned when they should
remain available as durable conversation context.

The default history limit is `50` root messages per session. It can be changed
with `SAY_TO_ME_MAX_TOTAL_MESSAGES`.

## What gets cleaned up

Message cleanup is scoped to one session and applies only to completed root
messages:

- A root message has no `parentId`.
- A root is eligible for cleanup when its status is not `queued`, `pending`, or
  `speaking`.
- User replies are part of their root message's thread. They do not consume an
  additional history slot, and they are deleted with that root.
- When eligible roots exceed the configured limit, the oldest eligible roots
  are removed until the limit is satisfied.
- Messages in other sessions are never removed by cleanup for the current
  session.

Cleanup runs after message creation, status changes, and pin changes. It is
also safe to delete a message explicitly regardless of its status or pin
state; pinning protects against automatic cleanup only.

## Pin behavior

Pinning is persisted on each message and defaults to unpinned. The session
message view exposes a `Pin` or `Unpin` action for persisted messages.

- A pinned root is excluded from automatic cleanup.
- A pinned reply protects its root thread from automatic cleanup. The root and
  all of its replies stay together so a pinned reply cannot become orphaned.
- A protected thread does not consume one of the cleanup limit's eligible-root
  slots. The session may therefore contain the configured number of eligible
  roots plus any protected threads.
- Pinning does not restore a message that was already deleted.
- Explicit deletion still removes a pinned message. Deleting a root through
  the existing thread-delete action also removes its replies.

Unpinning immediately runs cleanup again. If the session is over its limit,
the oldest newly eligible roots are removed at that point. Unpinning a reply
does not make its thread eligible while the root or another reply remains
pinned.

## Example

With a limit of `3`, a session contains four completed unpinned roots: `A`,
`B`, `C`, and `D`. Cleanup removes `A`, leaving `B`, `C`, and `D`.

If `A` is pinned, cleanup leaves `A`, `B`, `C`, and `D`; the pinned thread is
protected and the oldest eligible root is still removed whenever another
eligible root causes the eligible set to exceed `3`.

If a reply under `A` is pinned instead, `A` and its complete reply thread are
protected by the same rule.

## API contract

The message pin state is changed with:

```text
POST /api/messages/:id/pin
{"pinned": true}
```

The endpoint returns the resulting boolean pin state. It rejects a non-integer
message id, a non-boolean `pinned` value, or a message that does not exist.

## Invariants

- Automatic cleanup never deletes a pinned root or a thread containing a
  pinned reply.
- Automatic cleanup never deletes an in-progress root (`queued`, `pending`,
  or `speaking`).
- Cleanup never crosses session boundaries.
- Pin state survives server restarts because it is stored with the message in
  SQLite.
