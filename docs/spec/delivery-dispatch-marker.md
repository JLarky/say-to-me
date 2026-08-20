# Delivery Dispatch Marker

## Purpose

A delivery to a CLI-backed session is **not idempotent**. Prompting Cursor
(`cur_`), Claude (`cc_`), Codex (`cx_`), or Grok (`gr_`) is a real user turn:
the agent reads it, answers it, and may edit files because of it. Delivering
the same message twice is therefore not a harmless duplicate — it makes the
agent do the work twice.

Today the delivery queue treats a delivery like any other retryable job. It
records that a job was _claimed_, but never records that the prompt was
actually _handed to the provider_. On recovery it cannot tell these apart:

- claimed but never spawned — the prompt never reached the agent, so retrying
  is completely safe, and this is the common case (provider binary missing,
  session `cwd` gone, worker died early, transient spawn failure);
- spawned and consumed — retrying duplicates a real user turn.

Unable to distinguish them, the queue currently assumes the safe case and
retries, which is how a message gets delivered twice.

This spec adds the missing record. It does not change how delivery works when
nothing goes wrong.

It also answers, for external CLI delivery specifically, the open question in
[the roadmap](../roadmap.md) under _Harden database mutations, idempotency, and
restart recovery_: "which workflows require exactly-once behavior versus
at-least-once plus idempotency?" Prompting a provider is the exactly-once case,
because the side effect is a human-visible agent turn that cannot be undone by
a compensating write.

## Invariant

> Once a delivery job has been marked dispatched, that job must never be
> prompted into the provider again, by any path.

A job is _dispatched_ when the worker has committed to handing the prompt to
the provider. `prompt_dispatched_at` on each delivery jobs table records the
moment; the column already exists on all four tables and is currently unused.

Retries are still allowed — and still wanted — for jobs that were never
dispatched. The invariant removes duplicate turns without turning every
transient failure into a lost message.

## Marking dispatch

The worker marks the job dispatched **before** spawning the provider, and
waits for that mark to be durable before spawning.

Marking before spawn rather than after is deliberate. Either ordering has a
window; they fail in opposite directions:

- mark _after_ spawn — a crash between spawn and mark leaves a consumed prompt
  looking un-dispatched, so it gets re-prompted. The agent does the work twice.
- mark _before_ spawn — a crash between mark and spawn leaves an un-consumed
  prompt looking dispatched, so it is not retried. The message is reported
  failed and the user can resend.

The second failure is the better one to have. A duplicated turn is invisible
to the user and may have already changed files on disk; a message reported
failed is visible and recoverable. Prefer the honest failure over the silent
duplicate.

The mark must be conditional on the worker still holding the job's lease, so a
stale worker cannot mark a job that another worker now owns.

## Behavior by re-prompt path

Three paths can currently deliver a message a second time. All three consult
the marker.

**Worker retry after a failed delivery.** When the provider command fails, the
worker retries while attempts remain. A provider that exits non-zero _after_
consuming the prompt is the most common source of duplicate turns, because
from the worker's side it looks like an ordinary failure. A dispatched job must
not be retried here; it fails terminally instead.

**Stale lease reclaim.** A job whose lease expired is currently returned to the
queue to be claimed again. A dispatched job must not be returned to the queue;
it fails terminally instead. An un-dispatched job is reclaimed as it is today.

**Re-enqueue of a failed job.** Enqueuing the same message and kind again
revives a previously failed job. It must revive only un-dispatched jobs. The
marker is never cleared, so a dispatched job stays terminal.

## Failure classification

The marker says whether a prompt was handed over. Deciding what to do next also
needs to know _how_ the delivery failed, and that information is currently
destroyed: every failure is caught and flattened into a message string before
any policy sees it. That is why the retry decision today can only consult an
attempt count.

Delivery failures must be distinguishable by kind, not by parsing text:

- **Provider never started** — the executable is missing, the session `cwd` is
  gone, the spawn itself failed. The prompt cannot have been read. Retryable.
- **Provider ran and failed** — it started, then exited non-zero, timed out, or
  produced output that could not be parsed. The prompt may well have been read.
  Not retryable.
- **Lease lost** — renewal failed, so another worker now owns this job. This is
  not a delivery failure at all, and the worker must not record an outcome for a
  job it no longer holds. It stops and says so.

The retry rule is then a decision over the marker and the failure kind rather
than a counter, and it lives in one place instead of being restated in the
queue, in the worker, and in a default constant.

Note that "provider never started" and un-dispatched are close but not
identical: marking happens before spawn, so a spawn failure is a dispatched job
whose prompt provably never landed. This is the one case where a dispatched job
may safely be retried, and it is worth keeping precisely because it covers the
most common transient failure.

## Lease ownership

Every state transition on a delivery job is a compare-and-set against the
lease. Those predicates are currently written out at each call site, and they
have already drifted: renewal and completion disagree about which fields to
match, so a renewal that commits while a worker is finishing can make a
successful delivery fail to record its reply.

Build the predicate in one place and derive every transition from it. The rule
for what belongs in it: the fields that identify the attempt and its holder, and
nothing that changes _during_ the attempt. The lease timestamp is bumped by
every renewal, so it identifies a moment rather than an owner and must not gate
a transition. Holder identity is what the predicate is for.

## Failure reporting

A dispatched job that cannot be confirmed is a different outcome from a
delivery that never left the queue, and it should not claim to be the same
thing. "We could not confirm this reached the agent" is accurate; "failed to
send" is not, because the agent may well be acting on it right now.

Surface the two distinctly, so a user who sees the unconfirmed state knows to
check the session before resending rather than resending blindly.

## Non-goals

- **No change to `maxAttempts`.** Retries remain valuable for the un-dispatched
  failures, which are the majority. The marker, not an attempt budget, is what
  prevents duplicate turns.
- **No provider process discovery.** Determining whether a provider process is
  still alive is a separate concern, owned by
  [CLI Provider Stop](./cli-provider-stop.md). This spec deliberately does not
  scan the process table: the queue does not need to know whether the CLI is
  running, only whether it was ever handed the prompt. Inferring liveness by
  matching process arguments also cannot distinguish a provider the server
  spawned from one a human started in a terminal on the same session.
- **No new migration.** `prompt_dispatched_at` already exists.
- **No transcript inspection.** See follow-ups.
- **No convergence of the two delivery implementations.** The delivery
  lifecycle is currently written twice: once as an Effect workflow in
  `packages/external-cli-delivery`, and once in the REST worker that Boo
  actually runs. The workflow copy is not reachable in production — its worker
  loop has no call sites and its prompt client only supports echo mode. This
  spec changes the path that runs. Picking one implementation is worth doing,
  but it is a refactor with its own risk and does not belong here.

## Acceptance

Run for Cursor, Claude, Codex, and Grok.

1. **Happy path unchanged.** Send a message to an idle session; confirm it is
   delivered once, replies normally, and the job ends succeeded.
2. **Pre-dispatch failure still retries.** Point the provider binary at a
   missing executable so spawn fails. Confirm the job retries and, once the
   binary is restored, delivers exactly once.
3. **Post-dispatch failure does not re-prompt.** Have the provider consume the
   prompt and then exit non-zero. Confirm the message is reported unconfirmed,
   the job is terminal, and the provider is never invoked a second time for
   that message.
4. **Stale lease does not re-prompt.** Dispatch a job, then expire its lease
   without letting the worker finish. Confirm the job goes terminal rather than
   being claimed again, and that no second provider invocation occurs.
5. **Re-enqueue does not re-prompt.** After case 3 or 4, enqueue the same
   message and kind again. Confirm it does not deliver a second time.
6. **Un-dispatched reclaim still works.** Expire the lease of a job that was
   claimed but never dispatched. Confirm it is reclaimed and delivered.
7. **Spawn failure is retried even though dispatched.** Make the spawn itself
   fail after the mark is written. Confirm the job retries rather than going
   terminal, distinguishing failure kind from the marker alone.
8. **A renewal during completion does not lose the reply.** Let a lease renewal
   commit while a delivery is finishing. Confirm the reply is still recorded and
   the job ends succeeded.
9. **A worker that lost its lease records nothing.** Take a job's lease away
   from a running worker. Confirm that worker does not transition the job and
   reports the lease loss rather than a delivery failure.

Cases 3 and 4 are the regression tests for the bug this spec exists to fix, and
neither is covered today. Cases 8 and 9 cover the lease predicate drift, which
is also uncovered today.

## Follow-ups

Deliberately out of scope here, in order of value:

1. **Confirm dispatched deliveries from the transcript.** The unconfirmed
   outcome above is a genuine unknown, but it is answerable. The session
   transcript is the provider's own record of what it received, and parsers for
   all four providers already exist. Embedding the existing unused
   `dispatch_key` in the prompt as an ignorable marker makes "did this turn
   land?" a lookup, which turns most unconfirmed outcomes into a definite
   success or a safe retry.
2. **Supervise the provider on lease loss.** When lease renewal fails the
   worker currently keeps the provider running unsupervised and later discards
   its reply. Cancelling the in-flight provider instead — and terminating its
   descendants, not just the direct child — is what
   [CLI Provider Stop](./cli-provider-stop.md) already requires of Stop.
3. **One spawn lifecycle for all four providers.** Each provider hand-rolls
   spawn, output accumulation, a settle-once guard, and reply parsing. This is
   the one place where per-provider drift is real rather than theoretical, and a
   single combinator would remove it — including the failure classification
   above, which is the only part of this spec that reaches into provider files
   at all. Each provider already distinguishes the two cases structurally (a
   spawn error event versus a non-zero exit); they just report both as a bare
   error today. Until the combinator exists, each provider names its own two
   failure kinds, which is a small mechanical change but four copies of it.
4. **Pick one delivery implementation.** See the corresponding non-goal.
