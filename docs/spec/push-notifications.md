# Push Notifications

## Purpose

Say To Me has two distinct notification surfaces, and they serve different jobs:

1. **In-app notification panel** — the running audit of agent activity, shown in
   the top-right Notifications panel inside the app.
2. **Browser push** — an actual OS/device notification (delivered via the Web
   Push / VAPID stack and the service worker), used to pull the user's attention
   to the app when they are not looking at it.

The guiding principle: **the in-app panel records everything; browser push is
reserved for high-signal moments.** Browser push is opt-in per message, so the
device only buzzes when a message explicitly asks for it.

## In-app notification panel

- Every **agent** message records an in-app notification.
- The panel shows the latest notification per session and is the user-facing
  audit of what agents have said.
- This surface never depends on push configuration, a subscription, or OS
  notification permission. It always works.
- User messages do not record in-app notifications.

## Browser push

A browser push is sent **only** when an agent message carries a non-empty
`pushNotificationText` field.

- `pushNotificationText` is set by the agent when it creates the message.
- It is **agent-only**: a user message that includes `pushNotificationText` is
  rejected (`400`).
- Its value is the **body of the push** the device shows. The spoken/displayed
  `text` of the message is unaffected.
- A message without `pushNotificationText` produces **no** browser push — it is
  audible playback (if applicable) plus the in-app panel only.

There is exactly one source of OS notifications: the **server-sent web push**.
The client never raises its own OS notification for a message. This keeps "did
this message notify my device?" answerable from one place — the presence of
`pushNotificationText` — regardless of whether the app is open or backgrounded.

### What a push contains

- **title**: the app name.
- **body**: the message's `pushNotificationText`.
- **deep link**: tapping the notification opens the message's session.

## Subscriptions

Push delivery requires a subscription, and the subscription model is
**app-wide, not per-session**:

- The user subscribes **once for the whole app**. There is no per-session
  subscribe step and no per-session push state.
- Subscriptions are registered through a single sessionless endpoint
  (`POST /api/push-subscribe`).
- The server keeps subscriptions keyed by their push endpoint, so the same
  device/browser is stored once regardless of how many times it subscribes.
- The client registers the service worker and subscribes when OS notification
  permission is granted; this happens at the app level, not on individual
  session pages.

When an agent message has `pushNotificationText`, the server fans the push out
to **all** current subscriptions.

## Configuration

- Browser push requires VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  optional `VAPID_SUBJECT`).
- If VAPID is not configured, no browser push is sent. The in-app panel and
  message playback are unaffected.

## Subscription lifecycle

- A subscription that the push service reports as gone (`404`/`410`) is removed.
- Other (transient) send failures keep the subscription.

## Summary

| Event                                        | In-app panel | Browser push |
| -------------------------------------------- | ------------ | ------------ |
| Agent message without `pushNotificationText` | Yes          | No           |
| Agent message with `pushNotificationText`    | Yes          | Yes          |
| User message                                 | No           | No           |
