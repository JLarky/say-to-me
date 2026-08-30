import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-durable-delivery-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { opencodeDeliveryJobs } = await import("../db/drizzle-schema.ts");
const { drizzleDb, drizzleSqlite } = await import("../db/index.ts");
const { getMessage, insertMessageRow, updateOpencodeDelivery } = await import("../messages.ts");
const {
  makeOpenCodeDeliveryRuntime,
  OpenCodeDeliveryQueue,
  OpenCodeDeliveryQueueLive,
  OpenCodeDeliveryStatus,
  OpenCodePromptClient,
  runOpenCodeDeliveryOnce,
  WorkerIdentity,
  MessageStoreLive,
  DeliveryEffectsLive,
  confirmOpenCodeDeliveryFromObservedWork,
  confirmOpenCodeDeliveriesForSessionFromObservedWork,
  settleOrphanOpenCodeDeliveryMessages,
} = await import("./durable-delivery.ts");
import {
  type OpenCodeDeliveryQueueService,
  type OpenCodePromptClientService,
} from "./durable-delivery.ts";
import type { DbOpenCodeDeliveryJob } from "../db/schemas.ts";

const unusedQueue: OpenCodeDeliveryQueueService = {
  enqueue: () => Effect.die("unused"),
  claimNext: () => Effect.die("unused"),
  complete: () => Effect.die("unused"),
  retry: () => Effect.die("unused"),
  fail: () => Effect.die("unused"),
  cancel: () => Effect.die("unused"),
  returnToPending: () => Effect.die("unused"),
};

const unusedPrompt: OpenCodePromptClientService = {
  sendPrompt: () => Effect.die("unused"),
};

const unusedDeliveryLayer = Layer.mergeAll(
  Layer.succeed(OpenCodeDeliveryQueue, unusedQueue),
  Layer.succeed(OpenCodeDeliveryStatus, { getStatus: () => Effect.die("unused") }),
  Layer.succeed(OpenCodePromptClient, unusedPrompt),
  Layer.succeed(WorkerIdentity, { id: "test-worker" }),
  MessageStoreLive,
  DeliveryEffectsLive,
);

describe("OpenCode delivery runtime", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("interrupts kicked one-shot delivery fibers on stop", async () => {
    let resolveStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let interrupted = false;
    const runtime = makeOpenCodeDeliveryRuntime({
      deliveryLayer: unusedDeliveryLayer,
      kickProgram: Effect.async<void>(() => {
        resolveStarted();
        return Effect.sync(() => {
          interrupted = true;
        });
      }),
      workerLoop: Effect.void,
    });

    await Effect.runPromise(runtime.kick);
    await started;
    expect(interrupted).toBe(false);

    await Effect.runPromise(runtime.stop);

    expect(interrupted).toBe(true);
  });

  it("does not apply retry side effects when a stale worker loses its lease", async () => {
    const message = insertMessageRow({
      sessionId: "ses_1dd864100ffes6uqv2NbJatAKt",
      text: "stale retry side effect",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(message.id, "pending", null, null);
    const staleJob: DbOpenCodeDeliveryJob = {
      id: 1,
      messageId: message.id,
      messageSessionId: message.sessionId,
      opencodeSessionId: message.sessionId,
      kind: "direct_user_message",
      status: "running",
      useCli: 0,
      force: 0,
      attemptCount: 1,
      maxAttempts: 3,
      nextAttemptAt: 0,
      lockedAt: 100,
      lockedBy: "old-worker",
      lastError: null,
      opencodeMessageId: null,
      promptDispatchedAt: null,
      cliTurnEndedAt: null,
      createdAt: "2026-06-28 00:00:00",
      updatedAt: "2026-06-28 00:00:00",
    };
    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () => Effect.succeed(staleJob),
      complete: () => Effect.succeed(false),
      retry: () => Effect.succeed(false),
      fail: () => Effect.succeed(false),
      cancel: () => Effect.succeed(false),
      returnToPending: () => Effect.succeed(false),
    });
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () => Effect.succeed("failed" as const),
    });
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.succeed("idle" as const),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "old-worker" });

    await Effect.runPromise(
      runOpenCodeDeliveryOnce().pipe(
        Effect.provide(
          Layer.mergeAll(queue, prompt, status, worker, MessageStoreLive, DeliveryEffectsLive),
        ),
      ),
    );

    expect(getMessage(message.id)).toMatchObject({
      opencodeDeliveryStatus: "pending",
      opencodeDeliveryError: null,
    });
  });

  it("ignores stale delivery job lease completions", async () => {
    const message = insertMessageRow({
      sessionId: "ses_1dd864100ffes6uqv2NbJatAKt",
      text: "stale lease",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    const staleJob = drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: message.id,
        messageSessionId: message.sessionId,
        opencodeSessionId: message.sessionId,
        kind: "direct_user_message",
        status: "running",
        attemptCount: 1,
        lockedAt: 100,
        lockedBy: "old-worker",
        nextAttemptAt: 0,
      })
      .returning()
      .get();

    drizzleDb
      .update(opencodeDeliveryJobs)
      .set({ attemptCount: 2, lockedAt: 200, lockedBy: "new-worker" })
      .where(eq(opencodeDeliveryJobs.id, staleJob.id))
      .run();

    await Effect.runPromise(
      Effect.flatMap(OpenCodeDeliveryQueue, (queue) =>
        queue.complete(staleJob, "sent", "stale-opencode-message"),
      ).pipe(Effect.provide(OpenCodeDeliveryQueueLive)),
    );

    const current = drizzleDb
      .select()
      .from(opencodeDeliveryJobs)
      .where(eq(opencodeDeliveryJobs.id, staleJob.id))
      .get();
    expect(current).toMatchObject({
      status: "running",
      attemptCount: 2,
      lockedAt: 200,
      lockedBy: "new-worker",
      opencodeMessageId: null,
    });
    drizzleDb
      .update(opencodeDeliveryJobs)
      .set({ status: "succeeded" })
      .where(eq(opencodeDeliveryJobs.id, staleJob.id))
      .run();
  });

  it("fails an expired dispatched lease and blocks the second claimant", async () => {
    const sessionId = "ses_expired_dispatched";
    const message = insertMessageRow({
      sessionId,
      text: "expired prompt",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(message.id, "pending", null, null);
    const job = drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: message.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "running",
        attemptCount: 1,
        force: 1,
        lockedAt: 0,
        lockedBy: "waiting-worker",
        nextAttemptAt: 0,
        promptDispatchedAt: 123,
      })
      .returning()
      .get();

    const claimed = await Effect.runPromise(
      Effect.flatMap(OpenCodeDeliveryQueue, (queue) => queue.claimNext("second-worker")).pipe(
        Effect.provide(OpenCodeDeliveryQueueLive),
      ),
    );

    expect(claimed).toBeNull();
    expect(
      drizzleDb
        .select()
        .from(opencodeDeliveryJobs)
        .where(eq(opencodeDeliveryJobs.id, job.id))
        .get(),
    ).toMatchObject({
      status: "failed",
      lockedBy: null,
      promptDispatchedAt: 123,
    });
    expect(getMessage(message.id)).toMatchObject({
      opencodeDeliveryStatus: "pending",
      opencodeDeliveryError: null,
    });
  });

  it("fails a queued message when an expired dispatched lease never started work", async () => {
    const sessionId = "ses_expired_queued";
    const message = insertMessageRow({
      sessionId,
      text: "expired queued prompt",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(message.id, "queued", null, null);
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: message.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "running",
        attemptCount: 1,
        force: 1,
        lockedAt: 0,
        lockedBy: "waiting-worker",
        nextAttemptAt: 0,
        promptDispatchedAt: 123,
      })
      .run();

    const claimed = await Effect.runPromise(
      Effect.flatMap(OpenCodeDeliveryQueue, (queue) => queue.claimNext("second-worker")).pipe(
        Effect.provide(OpenCodeDeliveryQueueLive),
      ),
    );

    expect(claimed).toBeNull();
    expect(getMessage(message.id)).toMatchObject({
      opencodeDeliveryStatus: "failed",
      opencodeDeliveryError: "OpenCode delivery lease expired after prompt dispatch.",
    });
  });

  it("marks messages sent when OpenCode accepts delivery", async () => {
    const sessionId = "ses_a9a90eaf3fdeg4DB8GbnzkH7jl";
    const message = insertMessageRow({
      sessionId,
      text: "accepted delivery",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    const job: DbOpenCodeDeliveryJob = {
      id: 101,
      messageId: message.id,
      messageSessionId: message.sessionId,
      opencodeSessionId: message.sessionId,
      kind: "direct_user_message",
      status: "running",
      useCli: 0,
      force: 0,
      attemptCount: 1,
      maxAttempts: 3,
      nextAttemptAt: 0,
      lockedAt: 100,
      lockedBy: "sent-worker",
      lastError: null,
      opencodeMessageId: null,
      promptDispatchedAt: null,
      cliTurnEndedAt: null,
      createdAt: "2026-06-28 00:00:00",
      updatedAt: "2026-06-28 00:00:00",
    };
    let completedOutcome: string | null = null;
    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () => Effect.succeed(job),
      complete: (_job, outcome) =>
        Effect.sync(() => {
          completedOutcome = outcome;
          return true;
        }),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      returnToPending: () => Effect.die("unused"),
    });
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () => Effect.succeed("sent" as const),
    });
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.succeed("idle" as const),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "sent-worker" });

    await Effect.runPromise(
      runOpenCodeDeliveryOnce().pipe(
        Effect.provide(
          Layer.mergeAll(queue, prompt, status, worker, MessageStoreLive, DeliveryEffectsLive),
        ),
      ),
    );

    expect(getMessage(message.id)).toMatchObject({
      opencodeDeliveryStatus: "sent",
      opencodeDeliveryError: null,
    });
    expect(completedOutcome).toBe("sent");
  });

  it("force-sends even while the OpenCode session is still busy", async () => {
    const sessionId = "ses_f7de38f5023daq8sk71FnGr2HK";
    const message = insertMessageRow({
      sessionId,
      text: "force while busy",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    const job: DbOpenCodeDeliveryJob = {
      id: 102,
      messageId: message.id,
      messageSessionId: message.sessionId,
      opencodeSessionId: message.sessionId,
      kind: "direct_user_message",
      status: "running",
      useCli: 0,
      force: 1,
      attemptCount: 1,
      maxAttempts: 3,
      nextAttemptAt: 0,
      lockedAt: 100,
      lockedBy: "force-worker",
      lastError: null,
      opencodeMessageId: null,
      promptDispatchedAt: null,
      cliTurnEndedAt: null,
      createdAt: "2026-06-28 00:00:00",
      updatedAt: "2026-06-28 00:00:00",
    };
    let completedOutcome: string | null = null;
    const queue = Layer.succeed(OpenCodeDeliveryQueue, {
      enqueue: () => Effect.die("unused"),
      claimNext: () => Effect.succeed(job),
      complete: (_job, outcome) =>
        Effect.sync(() => {
          completedOutcome = outcome;
          return true;
        }),
      retry: () => Effect.die("unused"),
      fail: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      returnToPending: () => Effect.die("unused"),
    });
    const prompt = Layer.succeed(OpenCodePromptClient, {
      sendPrompt: () => Effect.succeed("sent" as const),
    });
    // Session reports busy: a non-forced job would be deferred back to "queued".
    const status = Layer.succeed(OpenCodeDeliveryStatus, {
      getStatus: () => Effect.succeed("pending" as const),
    });
    const worker = Layer.succeed(WorkerIdentity, { id: "force-worker" });

    await Effect.runPromise(
      runOpenCodeDeliveryOnce().pipe(
        Effect.provide(
          Layer.mergeAll(queue, prompt, status, worker, MessageStoreLive, DeliveryEffectsLive),
        ),
      ),
    );

    expect(getMessage(message.id)).toMatchObject({ opencodeDeliveryStatus: "sent" });
    expect(completedOutcome).toBe("sent");
  });
});

describe("OpenCode delivery enqueue races", () => {
  it("CAS failed->pending does not clobber a running job", async () => {
    const { enqueueOpenCodeDeliveryJob } = await import("./durable-delivery.ts");
    const sessionId = "ses_4bd08b4d72c5TcsZFVCQnBdjxn_race_running";
    const message = insertMessageRow({
      sessionId,
      text: "race",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(message.id, "failed", "boom", null);
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: message.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "failed",
        useCli: 0,
        force: 0,
        maxAttempts: 3,
        nextAttemptAt: Date.now(),
      })
      .run();

    const first = enqueueOpenCodeDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      opencodeSessionId: sessionId,
      kind: "direct_user_message",
    });
    expect(first.status).toBe("pending");

    drizzleDb
      .update(opencodeDeliveryJobs)
      .set({
        status: "running",
        lockedAt: Date.now(),
        lockedBy: "worker-1",
      })
      .where(eq(opencodeDeliveryJobs.id, first.id))
      .run();
    updateOpencodeDelivery(message.id, "sent", null, "oc_msg");

    const second = enqueueOpenCodeDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      opencodeSessionId: sessionId,
      kind: "direct_user_message",
    });
    expect(second.status).toBe("running");
    expect(getMessage(message.id)?.opencodeDeliveryStatus).toBe("sent");

    // failed CAS no-op when status is already running
    drizzleDb
      .update(opencodeDeliveryJobs)
      .set({ status: "failed", lockedAt: null, lockedBy: null })
      .where(eq(opencodeDeliveryJobs.id, first.id))
      .run();
    updateOpencodeDelivery(message.id, "failed", "x", null);
    drizzleDb
      .update(opencodeDeliveryJobs)
      .set({ status: "running", lockedAt: Date.now(), lockedBy: "w" })
      .where(eq(opencodeDeliveryJobs.id, first.id))
      .run();
    const raced = enqueueOpenCodeDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      opencodeSessionId: sessionId,
      kind: "direct_user_message",
    });
    expect(raced.status).toBe("running");
    expect(raced.lockedBy).toBe("w");
  });

  it("insert-first enqueue does not reset a concurrently succeeded job to queued", async () => {
    const { enqueueOpenCodeDeliveryJob } = await import("./durable-delivery.ts");
    const sessionId = "ses_4bd08b4d72c5TcsZFVCQnBdjxn_race_succeed";
    const message = insertMessageRow({
      sessionId,
      text: "succeed race",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });

    const winner = enqueueOpenCodeDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      opencodeSessionId: sessionId,
      kind: "direct_user_message",
    });
    drizzleDb
      .update(opencodeDeliveryJobs)
      .set({ status: "succeeded" })
      .where(eq(opencodeDeliveryJobs.id, winner.id))
      .run();
    updateOpencodeDelivery(message.id, "sent", null, "oc_done");

    const loser = enqueueOpenCodeDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      opencodeSessionId: sessionId,
      kind: "direct_user_message",
    });
    expect(loser.status).toBe("succeeded");
    expect(getMessage(message.id)?.opencodeDeliveryStatus).toBe("sent");
  });
});

describe("OpenCode confirm from observed agent work", () => {
  it("promotes a pending dispatched delivery to sent when an agent replies later", () => {
    const sessionId = "ses_aaaaaaaaaaaaConfirmOpn0001";
    const user = insertMessageRow({
      sessionId,
      text: "calculate 2+2",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(user.id, "pending", null, null);
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: user.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "failed",
        attemptCount: 1,
        nextAttemptAt: 0,
        promptDispatchedAt: Date.now() - 2_000,
        lastError: "OpenCode delivery lease expired after prompt dispatch.",
      })
      .run();
    insertMessageRow({
      sessionId,
      text: "2 plus 2 is 4",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
      parentId: user.id,
    });

    expect(confirmOpenCodeDeliveryFromObservedWork(user.id)).toBe(true);
    expect(getMessage(user.id)).toMatchObject({
      opencodeDeliveryStatus: "sent",
      opencodeDeliveryError: null,
    });
    expect(
      drizzleDb
        .select({ status: opencodeDeliveryJobs.status })
        .from(opencodeDeliveryJobs)
        .where(eq(opencodeDeliveryJobs.messageId, user.id))
        .get(),
    ).toMatchObject({ status: "succeeded" });
  });

  it("does not confirm when the job was never dispatched", () => {
    const sessionId = "ses_bbbbbbbbbbbbConfirmOpn0002";
    const user = insertMessageRow({
      sessionId,
      text: "never dispatched",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(user.id, "failed", "spawn failed before dispatch", null);
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: user.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "failed",
        attemptCount: 1,
        nextAttemptAt: 0,
        lastError: "spawn failed before dispatch",
      })
      .run();
    insertMessageRow({
      sessionId,
      text: "unrelated agent chatter",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    expect(confirmOpenCodeDeliveryFromObservedWork(user.id)).toBe(false);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("failed");
  });

  it("session scan confirms pending dispatched deliveries", () => {
    const sessionId = "ses_ccccccccccccccccConfirmOpn0003";
    const user = insertMessageRow({
      sessionId,
      text: "scan me",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(user.id, "pending", null, null);
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: user.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "failed",
        attemptCount: 1,
        nextAttemptAt: 0,
        promptDispatchedAt: Date.now() - 2_000,
      })
      .run();
    insertMessageRow({
      sessionId,
      text: "done",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
      parentId: user.id,
    });
    expect(confirmOpenCodeDeliveriesForSessionFromObservedWork(sessionId)).toBe(1);
    expect(getMessage(user.id)?.opencodeDeliveryStatus).toBe("sent");
  });

  it("promotes an expired dispatched lease to sent when an agent already replied", async () => {
    const sessionId = "ses_ddddddddddddConfirmOpn0004";
    const message = insertMessageRow({
      sessionId,
      text: "expired with reply",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(message.id, "pending", null, null);
    const job = drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: message.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "running",
        attemptCount: 1,
        force: 1,
        lockedAt: 0,
        lockedBy: "waiting-worker",
        nextAttemptAt: 0,
        promptDispatchedAt: Date.now() - 2_000,
      })
      .returning()
      .get();
    insertMessageRow({
      sessionId,
      text: "already answered",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
      parentId: message.id,
    });

    const claimed = await Effect.runPromise(
      Effect.flatMap(OpenCodeDeliveryQueue, (queue) => queue.claimNext("second-worker")).pipe(
        Effect.provide(OpenCodeDeliveryQueueLive),
      ),
    );

    expect(claimed).toBeNull();
    expect(
      drizzleDb
        .select()
        .from(opencodeDeliveryJobs)
        .where(eq(opencodeDeliveryJobs.id, job.id))
        .get(),
    ).toMatchObject({
      status: "succeeded",
      promptDispatchedAt: expect.any(Number),
    });
    expect(getMessage(message.id)).toMatchObject({
      opencodeDeliveryStatus: "sent",
      opencodeDeliveryError: null,
    });
  });
});

describe("OpenCode orphan delivery settle", () => {
  it("fails a pending dispatched job once OpenCode is idle with no agent reply", async () => {
    const sessionId = "ses_eeeeeeeeeeeeSettleIdle0001";
    const user = insertMessageRow({
      sessionId,
      text: "orphan pending",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(user.id, "pending", null, null);
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: user.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "failed",
        attemptCount: 1,
        nextAttemptAt: 0,
        promptDispatchedAt: Date.now() - 2_000,
        lastError: "OpenCode delivery lease expired after prompt dispatch.",
      })
      .run();

    await settleOrphanOpenCodeDeliveryMessages(async () => "idle");

    expect(getMessage(user.id)).toMatchObject({
      opencodeDeliveryStatus: "failed",
      opencodeDeliveryError: "OpenCode went idle with no agent reply after dispatch.",
    });
  });

  it("keeps a pending dispatched job while OpenCode is still working", async () => {
    const sessionId = "ses_ffffffffffffSettleBusy0002";
    const user = insertMessageRow({
      sessionId,
      text: "still working",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(user.id, "pending", null, null);
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: user.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "failed",
        attemptCount: 1,
        nextAttemptAt: 0,
        promptDispatchedAt: Date.now() - 2_000,
      })
      .run();

    await settleOrphanOpenCodeDeliveryMessages(async () => "pending");

    expect(getMessage(user.id)).toMatchObject({
      opencodeDeliveryStatus: "pending",
      opencodeDeliveryError: null,
    });
  });

  it("promotes a pending dispatched job to sent when settle sees a later agent reply", async () => {
    const sessionId = "ses_111111111111SettleSent0003";
    const user = insertMessageRow({
      sessionId,
      text: "orphan with reply",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    updateOpencodeDelivery(user.id, "pending", null, null);
    drizzleDb
      .insert(opencodeDeliveryJobs)
      .values({
        messageId: user.id,
        messageSessionId: sessionId,
        opencodeSessionId: sessionId,
        kind: "direct_user_message",
        status: "failed",
        attemptCount: 1,
        nextAttemptAt: 0,
        promptDispatchedAt: Date.now() - 2_000,
      })
      .run();
    insertMessageRow({
      sessionId,
      text: "here is the answer",
      extraMarkdown: null,
      author: "agent",
      status: "queued",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
      parentId: user.id,
    });

    await settleOrphanOpenCodeDeliveryMessages(async (id) => {
      if (id === sessionId) {
        throw new Error("status should not be required once a reply exists");
      }
      return "unavailable";
    });

    expect(getMessage(user.id)).toMatchObject({
      opencodeDeliveryStatus: "sent",
      opencodeDeliveryError: null,
    });
  });
});
