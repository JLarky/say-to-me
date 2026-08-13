# Embedded Session Cards

## Purpose

Embedded session cards show the current state of sessions mentioned by a message.

They let a user stay on one session page while watching work happen in another referenced session. A forwarded message should therefore show useful progress for its target session without requiring the user to open that target session or press Refresh.

## Card Contents

Each card should show enough context to identify and follow the referenced session:

- session title or id
- status label
- short summary of the latest meaningful activity
- latest message details when available
- message count and project context when available
- Open link and Insert mention action

Idle system messages are valid activity. They may appear as the latest activity after work finishes.

## Real-Time Updates

Referenced cards should update through the existing session event streams.

When session A is open and one of its messages references session B, changes in session B should refresh session A's payload so the embedded card for B updates live.

Expected sequence for forwarded work:

1. Before work starts, the card may show the target session as idle.
2. After the forwarded message is delivered or OpenCode begins work, the card should move to a working or busy state.
3. As target-session replies arrive, the card should show updated latest-message or summary text.
4. After the target session becomes idle, the card may show the idle system message.

Users should not need to press Refresh to observe this sequence.

## Status Semantics

The card summary and OpenCode status are separate signals.

The summary describes recent Say To Me message activity. The OpenCode status describes the runtime state of the referenced OpenCode session, such as idle or pending.

Both should update live when data is available. It is acceptable for one signal to change before the other because message delivery and OpenCode status polling happen through different code paths.

## SSE Shape

Do not add a new SSE endpoint for embedded cards.

The intended direction is fewer SSE endpoints over time. Embedded card updates should reuse existing session snapshots and session-list broadcasts. If a referenced session changes, any open session that references it should receive a fresh snapshot on its existing stream.

## Tolerance

The reference lookup may over-broadcast in rare cases, such as broad text matches. Over-broadcasting is acceptable when it only causes harmless refreshes. Missing updates is worse because it leaves the user staring at stale session state.
