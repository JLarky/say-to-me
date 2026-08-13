# Server State Durability

Server restarts should not lose user-visible OpenCode work. Keep correctness-critical workflow state in the database and rebuild runtime helpers from durable rows on startup.

Durable state:

- OpenCode delivery jobs store retry, lease, completion-watch, and idle-notification progress.
- Messages store idempotency keys, delivery status, and notification linkage.
- Session rows store imported OpenCode context.

Runtime-only state:

- Timers, fibers, queues, PubSub subscribers, connected clients, and cache maps are process-local implementation details.
- OpenCode status/session-info caches and short context-backfill cooldowns are intentionally ephemeral.
- Activity-hub streams and warm snapshots are intentionally ephemeral unless a future product requirement needs a durable last-known-activity view.

Startup behavior:

- The API resumes active delivery jobs, completion watches, and notification watches from database rows.
- Runtime maps and timers may disappear during a restart, but resumed workers must derive the next observable action from persisted rows.
- New durability work should first identify the durable source of truth, then treat in-memory state as a rebuildable acceleration layer.
