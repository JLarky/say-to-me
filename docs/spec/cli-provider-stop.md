# CLI Provider Stop

## Purpose

The Stop control for a CLI-backed session cancels the active delivery and
prevents that delivery from producing a later agent reply. It applies to
Cursor (`cur_`), Claude (`cc_`), Codex (`cx_`), and Grok (`gr_`) sessions.

Stopping is stronger than changing the UI to idle or marking the user message
failed. The provider command for that delivery must stop, and output from the
cancelled turn must never be added to the session afterward.

When Stop is **visible** is a busy-versus-idle question. Use
[Busy vs Idle (User Experience)](./busy-vs-idle.md): if the session is
working, people must see it as busy and be able to Stop from the Say To Me
UI. This spec describes what Stop does once you can click it. It does not
invent a second definition of busy.

## User-visible behavior

- Show `Stop <Provider>` while the provider is busy.
- Clicking Stop marks the active user message failed with `Stopped by user.`
- The session returns to idle after the provider process has stopped.
- Do not create, play, or notify for an agent reply from the stopped delivery.
- A later message may start a new worker and provider command normally.

Stop is scoped to the active delivery for that session. It must not stop work
in another session or treat a reply from another delivery as cancelled.

## Cancellation invariants

Cancellation must hold across every ordering of these events:

1. the delivery job is claimed;
2. Stop is requested;
3. the provider process is spawned;
4. the provider accepts the prompt;
5. the provider produces or posts a reply.

In particular:

- If Stop wins before spawn, the worker must not spawn the provider afterward.
- If Stop races with spawn, the provider process and its descendants must be
  terminated before Stop is considered complete.
- If Stop happens after provider acceptance, completion and voice-reply paths
  must reject output for the cancelled delivery.
- A worker exit signal is not sufficient evidence of cancellation when a
  provider process can outlive the worker.
- Cancellation state must be durable enough to fence stale workers and late
  callbacks after the Stop request returns.

## End-to-end acceptance test

Run this scenario for Cursor, Claude, Codex, and Grok:

1. Open an idle CLI-backed session.
2. Send `sleep 15 and reply 15`.
3. Confirm the session becomes busy and shows `Stop <Provider>`.
4. Wait five seconds, then click Stop.
5. Confirm the input message shows `Stopped by user.` and the session becomes
   idle.
6. Observe the session for at least 30 seconds after Stop.
7. Confirm no agent message containing `15` was created, spoken, or notified.
8. Confirm no provider process for the stopped session remains running.
9. Send a new message and confirm the provider can start normally.

The test fails if the input message is marked stopped but a late agent reply is
still persisted. A reply with a playback status such as `stopped` also fails:
the cancelled reply must not exist at all.

## Process-level verification

Tests should identify provider processes by the session/resume id rather than
only by executable name. Sample process polling is useful diagnostic evidence,
but the automated assertion should wait until the stopped session has no
matching provider process and should fail if a matching process appears after
Stop returns.

The API response for Stop should not report success until cancellation is
fenced and process teardown has completed, or it should return an explicit
error explaining why cancellation could not be confirmed.
