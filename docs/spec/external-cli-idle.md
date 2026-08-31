# External CLI idle authority

For Claude, Cursor, Codex, and Grok sessions, idle means exactly one thing: the spawned provider CLI child process exited.

Assistant messages, provider result events, quiet gaps, queue emptiness, elapsed time, delivery status, and `cli_turn_ended_at` are not idle authority. They may update UI or durable queue state, but they cannot release an idle notification.

## Runtime flow

1. Dispatch registers the notification target with polling disabled.
2. The provider adapter waits for the spawned child's `close` event.
3. The worker sends `processExited: true` with the terminal internal request only after that event.
4. The server records durable turn completion and performs one process-exit-authorized notification check.
5. The notification check rejects external CLI completion without that explicit witness.

The witness is intentionally in-memory and request-scoped. After a server restart, or when a worker and provider process are on different hosts, durable rows alone cannot recover it. Those cases stay silent until a same-host process-liveness check can prove that the recorded process no longer exists. This is a deliberate false-late bias: recovery must never guess idle from a timeout, missed heartbeat, or stale database marker.

Busy / Stop uses that same live-child witness. `isBusy` treats a session as in-turn while a spawned provider child is registered in the in-memory live-child map, not while `cli_turn_ended_at` is null. Queued jobs and claimed-but-not-dispatched jobs still count as busy. Stamping `cli_turn_ended_at` mid-turn must not hide Stop. A server restart clears the map and busy falls false-late, same policy as idle.

## Automated gate

`server/cursor/rest-delivery-worker.test.ts` contains the isolated process-level regression. It uses a real spawned fake Cursor executable on the test server's random non-5411 origin:

1. sleep 5 seconds;
2. emit the assistant reply `5`;
3. sleep 2 minutes;
4. emit the final reply `2 minutes`;
5. exit.

While the child sleeps, the test deliberately changes the durable row so every old database/timer heuristic reads idle. The test fails if any idle notification appears before child exit and requires exactly 1 notification afterward.

A matching busy-gate in the Cursor, Claude, Codex, and Grok REST delivery worker tests stamps `cli_turn_ended_at` mid-turn and requires `isBusy` to stay true until the child closes.
