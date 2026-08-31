import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CODEX_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_GROK_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";

const {
  closeTestServer,
  createApiMiddleware,
  createTestRequest,
  expectHandledResponse,
  listen,
  teardownApi,
} = await import("../api.harness.ts");
const { dispatchEffectApiRequest } = await import("../api-routes/effect-api.ts");
const { drizzleDb } = await import("../db/index.ts");
const {
  claudeDeliveryJobs,
  codexDeliveryJobs,
  cursorDeliveryJobs,
  grokDeliveryJobs,
  messages: messagesTable,
} = await import("../db/drizzle-schema.ts");
const { getMessage, insertMessageRow } = await import("../messages.ts");
const { setSessionCwd } = await import("../sessions.ts");
const claude = await import("../claude/durable-delivery.ts");
const cursor = await import("../cursor/durable-delivery.ts");
const codex = await import("../codex/durable-delivery.ts");
const grok = await import("../grok/durable-delivery.ts");
const { runClaudeRestDeliveryOnce } = await import("../claude/rest-delivery-worker.ts");
const { runCursorRestDeliveryOnce } = await import("../cursor/rest-delivery-worker.ts");
const { runCodexRestDeliveryOnce } = await import("../codex/rest-delivery-worker.ts");
const { runGrokRestDeliveryOnce } = await import("../grok/rest-delivery-worker.ts");

type DeliveryJobsTable =
  | typeof claudeDeliveryJobs
  | typeof cursorDeliveryJobs
  | typeof codexDeliveryJobs
  | typeof grokDeliveryJobs;

type Lease = { id: number; messageId: number };
type RetryOutcome = import("./durable-delivery.ts").RetryDeliveryOutcome;

const scriptDir = mkdtempSync(path.join(tmpdir(), "say-to-me-cli-force-send-"));
const invocationLog = path.join(scriptDir, "invocations.log");

/**
 * Stands in for any provider binary: records that the prompt was handed over,
 * then exits cleanly. Honors Codex's `-o <file>` last-message convention so the
 * Codex worker can read a reply instead of classifying unreadable output as a
 * failure. Invocation count is the spawn evidence for every test.
 */
function writeFakeProvider(name: string): string {
  const script = path.join(scriptDir, `${name}-ok.sh`);
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `printf 'invoked\\n' >> ${JSON.stringify(invocationLog)}`,
      'out=""',
      'prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "-o" ]; then out="$arg"; fi',
      '  prev="$arg"',
      "done",
      'if [ -n "$out" ]; then printf ok > "$out"; fi',
      ...(name === "cursor"
        ? ['printf \'{"type":"result","is_error":false,"result":"ok"}\\n\'']
        : []),
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  return script;
}

function invocationCount(): number {
  try {
    return readFileSync(invocationLog, "utf8").trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

const busyPidFile = path.join(scriptDir, "busy-provider.pid");

/**
 * Provider stand-in for interrupt tests: records its PID, then sleeps for
 * DONE_SLEEP <seconds> found anywhere in its arguments (the prompt carries it).
 * On TERM it removes the PID file and exits non-zero — the killed-turn shape
 * the Stop flow is supposed to produce.
 */
function writeSleepingProvider(name: string): string {
  const script = path.join(scriptDir, `${name}-sleep.sh`);
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `printf 'invoked %s\\n' "$(date +%s%N)" >> ${JSON.stringify(invocationLog)}`,
      `pidfile=${JSON.stringify(busyPidFile)}`,
      'printf \'%s\\n\' "$$" >> "$pidfile"',
      "n=0",
      "sleep_pid=",
      'for a in "$@"; do',
      '  case "$a" in',
      "    *DONE_SLEEP*)",
      '      n=$(printf \'%s\' "$a" | sed -n "s/.*DONE_SLEEP \\([0-9][0-9]*\\).*/\\1/p")',
      "      ;;",
      "  esac",
      "done",
      "case \"$n\" in ''|*[!0-9]*) n=0;; esac",
      'if [ "$n" -gt 0 ]; then',
      '  trap \'rm -f "$pidfile"; [ -n "$sleep_pid" ] && kill "$sleep_pid" 2>/dev/null; exit 42\' TERM',
      '  sleep "$n" &',
      "  sleep_pid=$!",
      '  wait "$!"',
      "fi",
      'out=""',
      'prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "-o" ]; then out="$arg"; fi',
      '  prev="$arg"',
      "done",
      'if [ -n "$out" ]; then printf ok > "$out"; fi',
      ...(name === "cursor"
        ? ['printf \'{"type":"result","is_error":false,"result":"ok"}\\n\'']
        : []),
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  return script;
}

/**
 * Minimal boo: `kill <name>` TERMs whatever PID the current busy provider
 * recorded. This is the process-teardown leg of the real Stop flow; the test
 * asserts against actual OS process state through it.
 */
function writeFakeBoo(): string {
  const script = path.join(scriptDir, "fake-boo.sh");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `pidStateFile=${JSON.stringify(busyPidFile)}`,
      'if [ "$1" = "kill" ] && [ -f "$pidStateFile" ]; then',
      '  kill "$(tail -n 1 "$pidStateFile")" 2>/dev/null || true',
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  return script;
}

function trackedBusyPid(): number | null {
  try {
    const raw = readFileSync(busyPidFile, "utf8").trim().split("\n").pop();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A single REST iteration returns false when the claim found nothing to do.
 * Under CI load that can happen transiently, so the handover steps poll
 * briefly before concluding the queue lost the forced job.
 */
async function runUntilHandedOver(
  backend: { runOnce: (workerId: string, sessionId: string) => Promise<boolean | "stale-worker"> },
  workerId: string,
  sessionId: string,
): Promise<boolean | "stale-worker"> {
  const deadline = Date.now() + 5_000;
  let result = await backend.runOnce(workerId, sessionId);
  while (result !== true && result !== "stale-worker" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    result = await backend.runOnce(workerId, sessionId);
  }
  return result;
}

async function waitForPredicate(description: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Latest user message id for a session (the composer-force probe). */
function latestUserMessageId(sessionId: string): number {
  const row = drizzleDb
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(eq(messagesTable.sessionId, sessionId), eq(messagesTable.author, "user")))
    .orderBy(desc(messagesTable.id))
    .limit(1)
    .get();
  if (!row) throw new Error(`No user message found for ${sessionId}.`);
  return row.id;
}

function agentReplyCount(sessionId: string): number {
  return drizzleDb
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(eq(messagesTable.sessionId, sessionId), eq(messagesTable.author, "agent")))
    .all().length;
}

let sessionCounter = 0;

function nextSessionId(prefix: string): string {
  sessionCounter += 1;
  const suffix = String(sessionCounter).padStart(12, "0");
  return `${prefix}00000000-0000-4000-8000-${suffix}`;
}

type BackendSuite<TJob extends Lease> = {
  label: string;
  prefix: string;
  modeEnv: string;
  binEnv: string;
  realMode: string;
  fakeProviderName: string;
  table: DeliveryJobsTable;
  enqueue: (messageId: number, sessionId: string, options?: { force?: boolean }) => void;
  claim: (workerId: string, sessionId?: string) => Promise<{ job: TJob } | null>;
  markDispatched: (job: TJob) => Promise<boolean>;
  complete: (job: TJob, reply: string | null) => Promise<boolean>;
  retryJob: (
    messageId: number,
    options?: { force?: boolean },
  ) => { outcome: RetryOutcome; job: TJob } | null;
  runOnce: (workerId: string, sessionId: string) => Promise<boolean | "stale-worker">;
};

function jobRow(table: DeliveryJobsTable, jobId: number) {
  const row = drizzleDb
    .select({
      status: table.status,
      force: table.force,
      lockedBy: table.lockedBy,
      lastError: table.lastError,
      promptDispatchedAt: table.promptDispatchedAt,
      cliTurnEndedAt: table.cliTurnEndedAt,
    })
    .from(table)
    .where(eq(table.id, jobId))
    .get();
  if (!row) throw new Error(`Delivery job ${jobId} disappeared.`);
  return row;
}

/** Latest job row for a message, read straight from the route-test side. */
function jobRowForMessage(table: DeliveryJobsTable, messageId: number) {
  const row = drizzleDb
    .select({
      id: table.id,
      status: table.status,
      force: table.force,
      promptDispatchedAt: table.promptDispatchedAt,
    })
    .from(table)
    .where(eq(table.messageId, messageId))
    .get();
  if (!row) throw new Error(`No delivery job row for message ${messageId}.`);
  return row;
}

function retryRequest(messageId: number) {
  const request = createTestRequest(`/api/messages/${messageId}/retry-delivery`, {
    method: "POST",
  });
  return dispatchEffectApiRequest(request).then((response) =>
    expectHandledResponse(response, request),
  );
}

function seedMessage(sessionId: string, text: string): number {
  setSessionCwd(sessionId, scriptDir);
  return insertMessageRow({
    sessionId,
    text,
    extraMarkdown: null,
    author: "user",
    status: "received",
    links: null,
    sessionRefs: null,
    clientMessageId: null,
  }).id;
}

/**
 * Put one delivery mid-turn and leave it there: claimed, dispatched, turn open.
 * This is exactly what the UI reports as busy ("Working") and what a queued
 * message's "Waiting for <provider> to be idle" refers to.
 */
async function seedBusyTurn<TJob extends Lease>(
  backend: BackendSuite<TJob>,
  sessionId: string,
): Promise<TJob> {
  const messageId = seedMessage(sessionId, "busy work");
  backend.enqueue(messageId, sessionId);
  const claimed = await backend.claim("worker-busy", sessionId);
  if (!claimed) throw new Error(`Expected ${backend.label} to hand out a job.`);
  const marked = await backend.markDispatched(claimed.job);
  if (!marked) throw new Error(`Expected ${backend.label} dispatch marker to stick.`);
  const row = jobRow(backend.table, claimed.job.id);
  expect(row).toMatchObject({
    status: "running",
    promptDispatchedAt: expect.any(Number),
    cliTurnEndedAt: null,
  });
  return claimed.job;
}

function describeBackend<TJob extends Lease>(backend: BackendSuite<TJob>): void {
  describe(backend.label, () => {
    let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;
    let origin = "";

    beforeEach(async () => {
      writeFileSync(invocationLog, "");
      rmSync(busyPidFile, { force: true });
      process.env.BOO_BIN = writeFakeBoo();
      drizzleDb.delete(backend.table).run();
      const started = await listen(createApiMiddleware());
      server = started.server;
      origin = started.origin;
      process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
      process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
      process.env[backend.modeEnv] = backend.realMode;
      process.env[backend.binEnv] = writeFakeProvider(backend.fakeProviderName);
    });

    afterEach(async () => {
      if (server) await closeTestServer(server);
      server = null;
      delete process.env.BOO_BIN;
      delete process.env.SAY_TO_ME_INTERNAL_URL;
      delete process.env[backend.modeEnv];
      delete process.env[backend.binEnv];
    });

    it("holds a queued message while another prompt's CLI turn is still open", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const busyJob = await seedBusyTurn(backend, sessionId);
      const queuedId = seedMessage(sessionId, "should wait for idle");
      backend.enqueue(queuedId, sessionId);

      // The automatic path must not hand this prompt over while the session
      // is mid-turn: queued has to actually mean waiting.
      await expect(backend.runOnce("worker-auto", sessionId)).resolves.toBe(false);

      expect(invocationCount()).toBe(0);
      expect(jobRow(backend.table, busyJob.id)).toMatchObject({
        status: "running",
        promptDispatchedAt: expect.any(Number),
        cliTurnEndedAt: null,
      });
      expect(jobRow(backend.table, getQueuedJobId(backend.table, queuedId))).toMatchObject({
        status: "pending",
        force: 0,
        promptDispatchedAt: null,
      });
      expect(getMessage(queuedId)?.opencodeDeliveryStatus).toBe("queued");
    });

    it("defers even when the earlier job left the queue with its turn still open", async () => {
      // Crash-window regression: a job can leave `running` (lease CAS lost,
      // confirmed-from-observed-work) while its open-turn marker survives.
      // Queue-empty alone was never idle; only a closed turn is.
      const sessionId = nextSessionId(backend.prefix);
      const busyJob = await seedBusyTurn(backend, sessionId);
      drizzleDb
        .update(backend.table)
        .set({ status: "succeeded", lockedAt: null, lockedBy: null })
        .where(eq(backend.table.id, busyJob.id))
        .run();

      const queuedId = seedMessage(sessionId, "waits out the stale open turn");
      backend.enqueue(queuedId, sessionId);

      await expect(backend.runOnce("worker-auto", sessionId)).resolves.toBe(false);

      expect(invocationCount()).toBe(0);
      expect(jobRow(backend.table, getQueuedJobId(backend.table, queuedId))).toMatchObject({
        status: "pending",
        force: 0,
      });
    });

    it("force send on a queued message hands the prompt over without waiting", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const busyJob = await seedBusyTurn(backend, sessionId);
      const queuedId = seedMessage(sessionId, "user insists on delivery now");
      backend.enqueue(queuedId, sessionId);
      const queuedJobId = getQueuedJobId(backend.table, queuedId);

      // Force send on a queued row goes through retry-delivery, which flips the
      // hold instead of duplicating the job.
      expect(backend.retryJob(queuedId, { force: true })).toMatchObject({
        outcome: "already_queued",
        job: { id: queuedJobId },
      });
      expect(jobRow(backend.table, queuedJobId)).toMatchObject({ status: "pending", force: 1 });

      await expect(backend.runOnce("worker-force", sessionId)).resolves.toBe(true);

      expect(invocationCount()).toBe(1);
      expect(jobRow(backend.table, queuedJobId).promptDispatchedAt).not.toBeNull();
      // The forced send skips only timing; durability and reporting are intact.
      expect(getMessage(queuedId)?.opencodeDeliveryStatus).toBe("sent");
      // The later forced dispatch supersedes the abandoned busy turn marker.
      expect(jobRow(backend.table, busyJob.id)).toMatchObject({
        status: "running",
        promptDispatchedAt: expect.any(Number),
        cliTurnEndedAt: expect.any(Number),
      });
    });

    it("composer force variant enqueues straight past the hold", async () => {
      const sessionId = nextSessionId(backend.prefix);
      await seedBusyTurn(backend, sessionId);
      const forcedId = seedMessage(sessionId, "sent with the force modifier");
      backend.enqueue(forcedId, sessionId, { force: true });

      await expect(backend.runOnce("worker-force", sessionId)).resolves.toBe(true);

      expect(invocationCount()).toBe(1);
      expect(getMessage(forcedId)?.opencodeDeliveryStatus).toBe("sent");
    });

    it("resumes automatic delivery once the busy turn closes", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const busyJob = await seedBusyTurn(backend, sessionId);
      const queuedId = seedMessage(sessionId, "patiently waiting");
      backend.enqueue(queuedId, sessionId);
      const queuedJobId = getQueuedJobId(backend.table, queuedId);

      await expect(backend.runOnce("worker-auto", sessionId)).resolves.toBe(false);
      expect(invocationCount()).toBe(0);

      // The busy worker observes process end and completes its own job.
      expect(await backend.complete(busyJob, "busy work done")).toBe(true);

      await expect(backend.runOnce("worker-auto", sessionId)).resolves.toBe(true);

      expect(invocationCount()).toBe(1);
      expect(jobRow(backend.table, queuedJobId).promptDispatchedAt).not.toBeNull();
      expect(getMessage(queuedId)?.opencodeDeliveryStatus).toBe("sent");
    });

    it("force send through the retry-delivery route promotes a queued job while busy", async () => {
      const sessionId = nextSessionId(backend.prefix);
      await seedBusyTurn(backend, sessionId);

      const queuedId = seedMessage(sessionId, "route-forced");
      backend.enqueue(queuedId, sessionId);

      const response = await retryRequest(queuedId);
      expect(response.status).toBe(200);

      // The route's force flag promoted the held job instead of duplicating it.
      expect(jobRowForMessage(backend.table, queuedId)).toMatchObject({
        status: "pending",
        force: 1,
        promptDispatchedAt: null,
      });

      const claimed = await backend.claim("route-worker", sessionId);
      expect(claimed?.job.messageId).toBe(queuedId);
    });

    it("retry without force stays an idempotent no-op that never flips the flag", async () => {
      const sessionId = nextSessionId(backend.prefix);
      await seedBusyTurn(backend, sessionId);

      const queuedId = seedMessage(sessionId, "plain retry must not promote");
      backend.enqueue(queuedId, sessionId);

      const result = backend.retryJob(queuedId);
      expect(result).toMatchObject({ outcome: "already_queued" });
      expect(jobRowForMessage(backend.table, queuedId)).toMatchObject({
        status: "pending",
        force: 0,
      });
      // Still held: no force, session still busy.
      await expect(backend.claim("worker-plain", sessionId)).resolves.toBeNull();
    });

    it("force on a failed job behaves as Retry: marker cleared, then forcing", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const messageId = seedMessage(sessionId, "failed, then force-retried");
      backend.enqueue(messageId, sessionId);
      const claimedJob = await (async () => {
        const claimed = await backend.claim("worker-a", sessionId);
        if (!claimed) throw new Error(`Expected ${backend.label} to hand out a job.`);
        return claimed.job;
      })();
      await backend.markDispatched(claimedJob);
      await backend.complete(claimedJob, null);
      // Simulate a lost outcome: terminal with the dispatch marker set.
      drizzleDb
        .update(backend.table)
        .set({ status: "failed", lastError: "lost", lockedAt: null, lockedBy: null })
        .where(eq(backend.table.id, claimedJob.id))
        .run();
      expect(jobRow(backend.table, claimedJob.id)).toMatchObject({
        status: "failed",
        promptDispatchedAt: expect.any(Number),
      });

      const result = backend.retryJob(messageId, { force: true });
      expect(result).toMatchObject({ outcome: "retried" });
      // The human override cleared the marker AND kept forcing.
      expect(jobRow(backend.table, claimedJob.id)).toMatchObject({
        status: "pending",
        force: 1,
        promptDispatchedAt: null,
        cliTurnEndedAt: null,
        lockedBy: null,
      });

      const reclaimed = await backend.claim("worker-b", sessionId);
      expect(reclaimed?.job.id).toBe(claimedJob.id);
    });

    it("a forced job claims ahead of older queued jobs for the same session", async () => {
      const sessionId = nextSessionId(backend.prefix);
      const olderId = seedMessage(sessionId, "older, unforced");
      backend.enqueue(olderId, sessionId);

      const newerForcedId = seedMessage(sessionId, "newer, forced");
      backend.enqueue(newerForcedId, sessionId, { force: true });

      // Forced first even though it is younger: a user's Force send must not
      // sit behind a busy-deferred queue monopolist.
      const first = await backend.claim("worker-order", sessionId);
      expect(first?.job.messageId).toBe(newerForcedId);
      if (!first) throw new Error(`Expected ${backend.label} to hand out a job.`);
      await backend.complete(first.job, null);

      const second = await backend.claim("worker-order", sessionId);
      expect(second?.job.messageId).toBe(olderId);
    });

    /**
     * The regression PR 42 shipped: force send used to be timing-only, so a
     * "forced" prompt waited behind the running provider anyway. Force send on
     * CLI backends must stop that provider through the Stop flow first — the
     * process must actually die — fence the killed turn, and only then spawn
     * the forced prompt.
     */
    it("force send via retry-delivery stops the running provider, then hands over", async () => {
      const sessionId = nextSessionId(backend.prefix);
      // The busy turn runs a provider that actually stays alive until stopped.
      process.env[backend.binEnv] = writeSleepingProvider(backend.fakeProviderName);

      const busyId = seedMessage(sessionId, "DONE_SLEEP 30");
      backend.enqueue(busyId, sessionId);
      const busyRun = backend.runOnce("worker-busy", sessionId);
      const busyPid = await waitForPredicate("provider to spawn", () => {
        const pid = trackedBusyPid();
        return pid != null && processAlive(pid);
      }).then(() => trackedBusyPid());
      if (busyPid == null) throw new Error(`${backend.label} provider pid missing.`);

      const queuedId = seedMessage(sessionId, "DONE_SLEEP 0");
      backend.enqueue(queuedId, sessionId);

      const response = await fetch(`${origin}/api/messages/${queuedId}/retry-delivery`, {
        method: "POST",
      });
      expect(response.status).toBe(200);

      // Stop happened first: the running CLI process is gone, and no second
      // prompt has been spawned yet.
      await waitForPredicate("killed provider to exit", () => !processAlive(busyPid));
      expect(invocationCount()).toBe(1);

      // The killed turn looks exactly like an explicit Stop fenced it.
      expect(jobRow(backend.table, getQueuedJobId(backend.table, busyId))).toMatchObject({
        status: "cancelled",
        lastError: "Stopped by user.",
        cliTurnEndedAt: expect.any(Number),
      });
      expect(getMessage(busyId)?.opencodeDeliveryStatus).toBe("failed");
      expect(getMessage(busyId)?.opencodeDeliveryError).toBe("Stopped by user.");

      // The forced message was promoted, not cancelled by its own interrupt.
      expect(jobRowForMessage(backend.table, queuedId)).toMatchObject({
        status: "pending",
        force: 1,
        promptDispatchedAt: null,
      });

      // Nothing spoke for the session between Stop and the forced handover.
      expect(agentReplyCount(sessionId)).toBe(0);

      // Only now does the forced prompt get handed over.
      const handedOver = await runUntilHandedOver(backend, "worker-force", sessionId);
      if (handedOver !== true) {
        throw new Error(
          `${backend.label} forced handover returned ${String(handedOver)}; queued row: ${JSON.stringify(
            jobRowForMessage(backend.table, queuedId),
          )}, busy row: ${JSON.stringify(jobRow(backend.table, getQueuedJobId(backend.table, busyId)))}`,
        );
      }
      expect(invocationCount()).toBe(2);
      expect(getMessage(queuedId)?.opencodeDeliveryStatus).toBe("sent");
      const repliesAfterForced = agentReplyCount(sessionId);

      // No late reply from the killed turn: once everything has settled, the
      // killed turn's cancellation still fences its output.
      await expect(busyRun).resolves.toBe(true);
      expect(agentReplyCount(sessionId)).toBe(repliesAfterForced);
    }, 20_000);

    it("composer force variant stops the running provider, then hands over", async () => {
      const sessionId = nextSessionId(backend.prefix);
      process.env[backend.binEnv] = writeSleepingProvider(backend.fakeProviderName);

      const busyId = seedMessage(sessionId, "DONE_SLEEP 30");
      backend.enqueue(busyId, sessionId);
      const busyRun = backend.runOnce("worker-busy", sessionId);
      await waitForPredicate("provider to spawn", () => {
        const pid = trackedBusyPid();
        return pid != null && processAlive(pid);
      });
      const busyPid = trackedBusyPid();
      if (busyPid == null) throw new Error(`${backend.label} provider pid missing.`);

      const created = await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", text: "DONE_SLEEP 0", forceOpencode: true }),
      });
      expect(created.status).toBe(201);
      const forcedId = latestUserMessageId(sessionId);
      expect(forcedId).not.toBe(busyId);

      await waitForPredicate("killed provider to exit", () => !processAlive(busyPid));
      expect(invocationCount()).toBe(1);
      expect(jobRowForMessage(backend.table, busyId)).toMatchObject({ status: "cancelled" });

      await expect(runUntilHandedOver(backend, "worker-force", sessionId)).resolves.toBe(true);
      expect(invocationCount()).toBe(2);
      expect(getMessage(forcedId)?.opencodeDeliveryStatus).toBe("sent");
      const repliesAfterForced = agentReplyCount(sessionId);

      // No late reply from the killed turn once everything has settled.
      await expect(busyRun).resolves.toBe(true);
      expect(agentReplyCount(sessionId)).toBe(repliesAfterForced);
    }, 20_000);
  });
}

/** The queued message's job row id, via its unique (messageId, kind) pairing. */
function getQueuedJobId(table: DeliveryJobsTable, messageId: number): number {
  const row = drizzleDb
    .select({ id: table.id })
    .from(table)
    .where(eq(table.messageId, messageId))
    .get();
  if (!row) throw new Error(`No delivery job for message ${messageId}.`);
  return row.id;
}

describeBackend({
  label: "Cursor",
  prefix: "cur_",
  modeEnv: "SAY_TO_ME_CURSOR_WORKER_MODE",
  binEnv: "SAY_TO_ME_CURSOR_BIN",
  realMode: "cursor",
  fakeProviderName: "cursor",
  table: cursorDeliveryJobs,
  enqueue: (messageId, sessionId, options) => {
    cursor.enqueueCursorDeliveryJob({
      messageId,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
      ...options,
    });
  },
  claim: cursor.claimCursorDeliveryJobForWorker,
  markDispatched: cursor.markCursorDeliveryJobDispatchedFromWorker,
  complete: cursor.completeCursorDeliveryJobFromWorker,
  retryJob: cursor.retryCursorDeliveryJob,
  runOnce: (workerId, sessionId) =>
    Effect.runPromise(runCursorRestDeliveryOnce(workerId, sessionId)),
});

describeBackend({
  label: "Claude",
  prefix: "cc_",
  modeEnv: "SAY_TO_ME_CLAUDE_WORKER_MODE",
  binEnv: "SAY_TO_ME_CLAUDE_BIN",
  realMode: "claude",
  fakeProviderName: "claude",
  table: claudeDeliveryJobs,
  enqueue: (messageId, sessionId, options) => {
    claude.enqueueClaudeDeliveryJob({
      messageId,
      messageSessionId: sessionId,
      claudeSessionId: sessionId,
      kind: "direct_user_message",
      ...options,
    });
  },
  claim: claude.claimClaudeDeliveryJobForWorker,
  markDispatched: claude.markClaudeDeliveryJobDispatchedFromWorker,
  complete: claude.completeClaudeDeliveryJobFromWorker,
  retryJob: claude.retryClaudeDeliveryJob,
  runOnce: (workerId, sessionId) =>
    Effect.runPromise(runClaudeRestDeliveryOnce(workerId, sessionId)),
});

describeBackend({
  label: "Codex",
  prefix: "cx_",
  modeEnv: "SAY_TO_ME_CODEX_WORKER_MODE",
  binEnv: "SAY_TO_ME_CODEX_BIN",
  realMode: "codex",
  fakeProviderName: "codex",
  table: codexDeliveryJobs,
  enqueue: (messageId, sessionId, options) => {
    codex.enqueueCodexDeliveryJob({
      messageId,
      messageSessionId: sessionId,
      codexSessionId: sessionId,
      kind: "direct_user_message",
      ...options,
    });
  },
  claim: codex.claimCodexDeliveryJobForWorker,
  markDispatched: codex.markCodexDeliveryJobDispatchedFromWorker,
  complete: codex.completeCodexDeliveryJobFromWorker,
  retryJob: codex.retryCodexDeliveryJob,
  runOnce: (workerId, sessionId) =>
    Effect.runPromise(runCodexRestDeliveryOnce(workerId, sessionId)),
});

describeBackend({
  label: "Grok",
  prefix: "gr_",
  modeEnv: "SAY_TO_ME_GROK_WORKER_MODE",
  binEnv: "SAY_TO_ME_GROK_BIN",
  realMode: "grok",
  fakeProviderName: "grok",
  table: grokDeliveryJobs,
  enqueue: (messageId, sessionId, options) => {
    grok.enqueueGrokDeliveryJob({
      messageId,
      messageSessionId: sessionId,
      grokSessionId: sessionId,
      kind: "direct_user_message",
      ...options,
    });
  },
  claim: grok.claimGrokDeliveryJobForWorker,
  markDispatched: grok.markGrokDeliveryJobDispatchedFromWorker,
  complete: grok.completeGrokDeliveryJobFromWorker,
  retryJob: grok.retryGrokDeliveryJob,
  runOnce: (workerId, sessionId) => Effect.runPromise(runGrokRestDeliveryOnce(workerId, sessionId)),
});

afterAll(async () => {
  await teardownApi();
});
