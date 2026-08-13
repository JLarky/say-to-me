# Roadmap

The highest-leverage work planned for Say To Me. Each item states the problem, the
intended outcome, what would make it done, and the questions still open.

These are directions, not commitments, and the open questions are genuinely open —
if you have an opinion on one, that is a good place to start a discussion.

## Introduce durable tasks, runs, and artifacts

### Problem

Say To Me currently overloads messages with conversation, delegation, delivery, completion-watch, and result semantics. This makes the core product question, "who is working on what?", depend on inference across many message fields.

### Proposed outcome

Introduce first-class durable entities:

- **Task**: objective, owner session, state, priority, dependencies, timestamps
- **Run**: provider attempt, lifecycle state, terminal reason, retries, timing
- **Artifact**: diff, commit, PR, screenshot, test output, report, or external link

Messages remain conversation records and can reference tasks/runs rather than carrying their entire lifecycle.

### Acceptance criteria

- Existing forward-and-notify behavior maps onto explicit task/run state.
- Migration preserves existing message history and completion links.
- API and UI can answer who owns work, current state, blocker, and evidence without heuristic message-field inference.
- Restart recovery derives pending work from durable rows.
- State transitions and invariants have focused tests.

### Design questions

- Should every forwarded message create a task, or only explicit delegation?
- Should tasks span multiple sessions/runs?
- Which artifacts are stored versus linked?

## Unify provider capabilities behind adapters and contract tests

### Problem

Codex, Claude, Cursor, Grok, and OpenCode implement similar session operations through parallel code paths with uneven capability and error semantics. UI and routes increasingly branch on provider/session identity.

### Proposed outcome

Define one typed provider capability contract covering:

- create/resume
- deliver/stop
- activity and waiting state
- title
- model and reasoning effort
- reset/session-state synchronization
- artifacts and worktree metadata

Unsupported capabilities must be explicit data, not missing methods or runtime guesses.

### Acceptance criteria

- Every provider has one adapter implementing the common contract.
- Shared contract tests run against all adapters.
- Routes and UI consume capability data instead of provider-specific regex branches where practical.
- Provider-specific parsing remains isolated behind adapters.
- Existing behavior remains compatible so narrower provider work can land incrementally.

### Design questions

- Should OpenCode and external CLI adapters share one interface or implement related interfaces?
- Which operations need Effect services versus pure provider metadata?
- How should model-dependent capabilities be represented?

## Add managed worktree isolation and collision detection

### Problem

Multiple agents can operate in the same repository, branch, or worktree concurrently. Say To Me can delegate work but does not reliably prevent silent write collisions or make workspace ownership obvious.

### Proposed outcome

Add managed workspace isolation for delegated coding tasks:

- detect active session ownership of cwd/branch/worktree
- offer an isolated worktree and branch
- display ownership in session/task UI
- define cleanup and handoff lifecycle
- permit intentional sharing only through explicit confirmation

### Acceptance criteria

- Dispatch detects conflicting active writers before work begins.
- User can choose isolate, intentionally share, or cancel.
- Managed worktrees have deterministic naming and durable ownership metadata.
- Cleanup never deletes unmerged or dirty work.
- Restart recovery preserves ownership.
- Integration tests cover collision detection, creation, handoff, and safe cleanup.

### Design questions

- Should isolation be default for all coding delegation or opt-in?
- Who owns merging and conflict resolution?
- How should provider-native worktrees interoperate with app-managed worktrees?

## Harden database mutations, idempotency, and restart recovery

### Problem

Coupled workflows can perform multiple database writes and broadcasts. Partial failure risks inconsistent task, reset, forwarding, delivery, or notification state. Some DB-backed Effect services still need auditing for typed failure paths.

### Proposed outcome

Define and enforce reliability rules:

- transactions for coupled writes
- typed Effect failures for DB operations
- idempotency keys for retryable commands
- broadcast only after commit
- migration compatibility checks
- backup/restore verification
- restart recovery from durable state

### Acceptance criteria

- Inventory correctness-critical multi-write workflows.
- Fault-injection tests prove no partial state and no pre-commit broadcast.
- Replayed requests do not duplicate work.
- DB failures remain typed errors rather than defects.
- Migration checks run against copied databases in CI.
- Backup/restore and process-restart tests cover pending delivery, delegation, completion, and timers.
- Document invariants and transaction boundaries.

### Design questions

- Which workflows require exactly-once behavior versus at-least-once plus idempotency?
- Should an outbox table coordinate DB commits and SSE/push delivery?

## Add agent operations health metrics and dashboard

### Problem

Say To Me has low-level tracing, but lacks product-level visibility into whether multi-agent supervision is healthy. Users cannot quickly see stuck work, repeated failures, slow completion, or high intervention load.

### Proposed outcome

Add privacy-conscious lifecycle metrics and a local operations view for:

- queue age and depth
- active/stuck runs
- delivery retries and provider error rate
- completion latency
- human intervention/escalation rate
- task terminal reasons
- success evidence presence
- token/cost data when providers expose it

### Acceptance criteria

- Every run has lifecycle timestamps and a terminal reason.
- Dashboard highlights unhealthy work and links to actionable session/task context.
- Thresholds are configurable and avoid noisy alerts.
- Metrics never include prompt/content by default.
- Provider telemetry gaps are explicit.
- Tests cover lifecycle calculation, stuck detection, and privacy redaction.
- Document which metrics are local-only versus exported through OpenTelemetry.

### Design questions

- What counts as successful completion: agent claim, passing tests, artifact, or human acceptance?
- Which alerts deserve push notification versus passive dashboard status?

## Decompose oversized UI modules and mega-test suites

### Problem

Several files have become change hotspots and weak ownership boundaries:

- `SessionStatusControls.tsx`
- `OrganizePage.tsx`
- `SessionPage.tsx`
- `MessageList.tsx`
- `JarvisTimers.tsx`
- `thread-identity.test.tsx`
- `api.messages.test.ts`
- `api.opencode.test.ts`

Large files increase merge conflicts, obscure feature boundaries, and make failures harder to localize.

### Proposed outcome

Split code by product capability, with each feature owning its UI, schemas/state hooks, fixtures, and focused tests.

### Acceptance criteria

- Establish documented module and test ownership boundaries.
- Extract cohesive feature modules without behavior changes.
- Replace repeated mock server/setup code with typed shared fixtures.
- Preserve full behavior coverage.
- Record before/after test runtime and failure-localization impact.
- Add lightweight line/complexity guardrails that discourage new mega-files without forcing arbitrary fragmentation.

### Design questions

- Which boundaries should follow routes, provider capabilities, or user workflows?
- What file-size guardrail is useful without becoming cargo cult?

## Consolidate production hosting and test through direct Request handlers

### Problem

The project retains Express compatibility alongside the Astro/Elysia web-native path, plus TCP-mounted integration tests created during migration. This keeps duplicate hosting concepts and avoidable test overhead.

See `docs/api-hosting-migration.md`.

### Proposed outcome

Choose one production host around the existing host-neutral `Request -> Response` dispatch seam and migrate integration coverage to direct request handling where sockets are not the behavior under test.

### Acceptance criteria

- Parity suite covers JSON APIs, SSE, uploads/files, mutations, errors, and SPA fallback.
- Production entrypoint uses the selected host path.
- Direct `Request -> Response` tests replace temporary TCP-mounted tests.
- Socket-level tests remain only for behavior that genuinely requires networking.
- Obsolete adapter glue, scripts, and migration documentation are removed or archived.
- Startup, shutdown, HMR, tracing, and build/preview behavior are documented.

### Design questions

- Is Astro/Elysia ready to become the only production host?
- Which SSE and streaming cases still warrant socket tests?
