import { and, asc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { broadcastQueue } from "./broadcast.ts";
import { drizzleDb } from "./db/index.ts";
import {
  claudeDeliveryJobs,
  codexDeliveryJobs,
  cursorDeliveryJobs,
  opencodeDeliveryJobs,
} from "./db/drizzle-schema.ts";
import {
  enqueueSourceCompletionNotice,
  getSessionWorkStatus,
} from "./external-cli/session-work-status.ts";
import {
  getMessage,
  getMessageByClientId,
  getExistingForwardIdleNotification,
  insertForwardMessageRow,
  insertMessageRow,
  setCompletionWatchStatus,
  updateForwardStatus,
  updateForwardTarget,
  updateOpencodeDelivery,
} from "./messages.ts";
import { stopCompletionWatch } from "./opencode/completion-watch.ts";
import { enqueueClaudeDeliveryJob } from "./claude/durable-delivery.ts";
import { enqueueCursorDeliveryJob } from "./cursor/durable-delivery.ts";
import { enqueueCodexDeliveryJob } from "./codex/durable-delivery.ts";
import { enqueueGrokDeliveryJob } from "./grok/durable-delivery.ts";
import {
  enqueueOpenCodeDeliveryJob,
  retryOpenCodeDeliveryJob,
} from "./opencode/durable-delivery.ts";
import { detectSessionBackend } from "./session-id.ts";

const forwardCompletionPollMs = Number(process.env.SAY_TO_ME_FORWARD_COMPLETION_POLL_MS || 5_000);

type ForwardCompletionWatch = {
  sourceMessageId: number;
  sourceSessionId: string;
  targetMessageId: number;
  targetSessionId: string;
  seenWorking: boolean;
};

type StartForwardCompletionNotificationWatchOptions = ForwardCompletionWatch & {
  autoPoll?: boolean;
};

export type ResumableNotificationWatch =
  | { kind: "idle"; sessionId: string; triggerMessageId: number }
  | {
      kind: "forward_completion";
      sourceMessageId: number;
      sourceSessionId: string;
      targetMessageId: number;
      targetSessionId: string;
    };

export type NotificationWatchRepositoryService = {
  listResumable: () => Effect.Effect<ResumableNotificationWatch[]>;
};

export type NotificationWatchSchedulerService = {
  startIdle: (watch: Extract<ResumableNotificationWatch, { kind: "idle" }>) => Effect.Effect<void>;
  startForwardCompletion: (
    watch: Extract<ResumableNotificationWatch, { kind: "forward_completion" }>,
  ) => Effect.Effect<void>;
};

export const NotificationWatchRepository = Context.GenericTag<NotificationWatchRepositoryService>(
  "say-to-me/NotificationWatchRepository",
);
export const NotificationWatchScheduler = Context.GenericTag<NotificationWatchSchedulerService>(
  "say-to-me/NotificationWatchScheduler",
);

const forwardCompletionWatches = new Map<number, ForwardCompletionWatch>();
const forwardCompletionTimers = new Map<number, ReturnType<typeof setInterval>>();

function systemTextFragment(text: string): string {
  return text.replace(/[<>]/g, "").trim();
}

function sourceIdleNotificationText(targetSessionId: string, targetMessageId: number): string {
  const targetMessage = getMessage(targetMessageId);
  const prompt = targetMessage?.text ? systemTextFragment(targetMessage.text) : "";
  const context = prompt ? ` after message: ${prompt}` : "";
  return `<say-to-me-system>${targetSessionId} is idle now${context}</say-to-me-system>`;
}

export function hasForwardCompletionNotificationWatch(sourceMessageId: number): boolean {
  return forwardCompletionWatches.has(sourceMessageId);
}

type IdleNotificationWatch = {
  sessionId: string;
  triggerMessageId: number;
  seenWorking: boolean;
};

const idleNotificationWatches = new Map<number, IdleNotificationWatch>();
const idleNotificationTimers = new Map<number, ReturnType<typeof setInterval>>();

function ensureTargetIdleNotification(sessionId: string, clientMessageId: string) {
  const existing = getMessageByClientId(sessionId, "user", clientMessageId);
  if (existing) return existing;
  return insertMessageRow({
    sessionId,
    text: `<say-to-me-system>${sessionId} is idle now</say-to-me-system>`,
    extraMarkdown: null,
    author: "user",
    status: "received",
    links: null,
    sessionRefs: JSON.stringify([{ id: sessionId }]),
    clientMessageId,
  });
}

function shouldDeliverNotification(message: ReturnType<typeof getMessage>): boolean {
  if (!message) return false;
  if (
    message.opencodeDeliveryStatus === "sent" ||
    message.opencodeDeliveryStatus === "cli_timed_out" ||
    message.opencodeDeliveryStatus === "pending" ||
    message.opencodeDeliveryStatus === "ui_only"
  ) {
    return false;
  }

  if (message?.mergedIntoMessageId != null) {
    const merged = getMessage(message.mergedIntoMessageId);
    return (
      merged?.opencodeDeliveryStatus !== "sent" &&
      merged?.opencodeDeliveryStatus !== "cli_timed_out" &&
      merged?.opencodeDeliveryStatus !== "pending"
    );
  }

  return true;
}

export function startIdleNotificationWatch({
  sessionId,
  triggerMessageId,
  seenWorking = false,
}: Omit<IdleNotificationWatch, "seenWorking"> & { seenWorking?: boolean }): void {
  const existing = idleNotificationWatches.get(triggerMessageId);
  idleNotificationWatches.set(triggerMessageId, {
    sessionId,
    triggerMessageId,
    seenWorking: existing?.seenWorking || seenWorking,
  });

  if (idleNotificationTimers.has(triggerMessageId)) return;
  const timer = setInterval(() => {
    void checkIdleNotification(triggerMessageId);
  }, forwardCompletionPollMs);
  timer.unref?.();
  idleNotificationTimers.set(triggerMessageId, timer);
}

export async function checkIdleNotification(triggerMessageId: number): Promise<boolean> {
  const watch = idleNotificationWatches.get(triggerMessageId);
  if (!watch) return false;

  const status = await getSessionWorkStatus(watch.sessionId);
  if (status === "pending") {
    idleNotificationWatches.set(triggerMessageId, { ...watch, seenWorking: true });
    return false;
  }
  if (status !== "idle" || !watch.seenWorking) return false;

  const notification = ensureTargetIdleNotification(
    watch.sessionId,
    `target-idle-${watch.triggerMessageId}`,
  );
  updateOpencodeDelivery(notification.id, "ui_only", null, null);
  stopIdleNotificationWatch(triggerMessageId);
  broadcastQueue(watch.sessionId);
  return true;
}

export function stopIdleNotificationWatch(triggerMessageId: number): void {
  idleNotificationWatches.delete(triggerMessageId);
  const timer = idleNotificationTimers.get(triggerMessageId);
  if (timer) clearInterval(timer);
  idleNotificationTimers.delete(triggerMessageId);
}

export function startForwardCompletionNotificationWatch({
  sourceMessageId,
  sourceSessionId,
  targetMessageId,
  targetSessionId,
  seenWorking = false,
  autoPoll = true,
}: Omit<StartForwardCompletionNotificationWatchOptions, "seenWorking"> & {
  seenWorking?: boolean;
}): void {
  const existing = forwardCompletionWatches.get(sourceMessageId);
  forwardCompletionWatches.set(sourceMessageId, {
    sourceMessageId,
    sourceSessionId,
    targetMessageId,
    targetSessionId,
    seenWorking: existing?.seenWorking || seenWorking,
  });

  if (!autoPoll || forwardCompletionTimers.has(sourceMessageId)) return;
  const timer = setInterval(() => {
    void checkForwardCompletionNotification(sourceMessageId);
  }, forwardCompletionPollMs);
  timer.unref?.();
  forwardCompletionTimers.set(sourceMessageId, timer);
}

export async function checkForwardCompletionNotification(
  sourceMessageId: number,
): Promise<boolean> {
  const watch = forwardCompletionWatches.get(sourceMessageId);
  if (!watch) return false;

  const status = await getSessionWorkStatus(watch.targetSessionId);
  if (status === "pending") {
    forwardCompletionWatches.set(sourceMessageId, { ...watch, seenWorking: true });
    return false;
  }

  if (status === "idle" && !watch.seenWorking) {
    const targetMessage = getMessage(watch.targetMessageId);
    if (targetMessage?.opencodeDeliveryStatus === "queued") {
      const targetBackend = detectSessionBackend(watch.targetSessionId);
      if (targetBackend === "claude") {
        enqueueClaudeDeliveryJob({
          messageId: targetMessage.id,
          messageSessionId: targetMessage.sessionId,
          claudeSessionId: watch.targetSessionId,
          kind: "forward_target_message",
        });
      } else if (targetBackend === "cursor") {
        enqueueCursorDeliveryJob({
          messageId: targetMessage.id,
          messageSessionId: targetMessage.sessionId,
          cursorSessionId: watch.targetSessionId,
          kind: "forward_target_message",
        });
      } else if (targetBackend === "codex") {
        enqueueCodexDeliveryJob({
          messageId: targetMessage.id,
          messageSessionId: targetMessage.sessionId,
          codexSessionId: watch.targetSessionId,
          kind: "forward_target_message",
        });
      } else if (targetBackend === "grok") {
        enqueueGrokDeliveryJob({
          messageId: targetMessage.id,
          messageSessionId: targetMessage.sessionId,
          grokSessionId: watch.targetSessionId,
          kind: "forward_target_message",
        });
      } else if (targetBackend === "opencode") {
        if (!retryOpenCodeDeliveryJob(targetMessage.id)) {
          enqueueOpenCodeDeliveryJob({
            messageId: targetMessage.id,
            messageSessionId: targetMessage.sessionId,
            opencodeSessionId: watch.targetSessionId,
            kind: "forward_target_message",
          });
        }
      }
      // voice / none: explicit no-op — never fall through to OpenCode delivery.
      updateForwardTarget(watch.sourceMessageId, watch.targetMessageId, "queued");
      updateForwardStatus(watch.targetMessageId, "queued");
      broadcastQueue(watch.sourceSessionId);
      broadcastQueue(watch.targetSessionId);
      return false;
    }
  }

  if (status !== "idle" || !watch.seenWorking) return false;

  const targetNotification = ensureTargetIdleNotification(
    watch.targetSessionId,
    `target-idle-${watch.sourceMessageId}`,
  );
  updateOpencodeDelivery(targetNotification.id, "ui_only", null, null);
  const sourceClientMessageId = `forward-idle-${watch.sourceMessageId}`;
  const sourceMessage = getMessage(watch.sourceMessageId);
  const existingLinkedNotification =
    sourceMessage?.forwardStatus === "notified" && sourceMessage.forwardTargetMessageId != null
      ? getMessage(sourceMessage.forwardTargetMessageId)
      : null;
  const existingSourceNotification =
    existingLinkedNotification ??
    getMessageByClientId(watch.sourceSessionId, "user", sourceClientMessageId);
  const sourceIsPending = (await getSessionWorkStatus(watch.sourceSessionId)) === "pending";
  const coalescedSourceNotification = !existingSourceNotification
    ? getExistingForwardIdleNotification(watch.sourceSessionId, watch.targetSessionId)
    : null;
  const sourceNotification =
    existingSourceNotification ??
    coalescedSourceNotification ??
    insertForwardMessageRow({
      sessionId: watch.sourceSessionId,
      text: sourceIdleNotificationText(watch.targetSessionId, watch.targetMessageId),
      author: "user",
      status: "received",
      sessionRefs: JSON.stringify([{ id: watch.targetSessionId }]),
      clientMessageId: sourceClientMessageId,
      forwardRole: "target",
      forwardSourceSessionId: watch.targetSessionId,
      forwardSourceMessageId: targetNotification.id,
      forwardTargetSessionId: watch.sourceSessionId,
      forwardTargetMessageId: null,
      forwardStatus: "notified",
    });

  // Safer default: never interrupt a busy source session. Queue one coalesced
  // idle notice for later delivery instead of sending multiple notices now.
  if (shouldDeliverNotification(sourceNotification)) {
    if (sourceIsPending) {
      if (!existingSourceNotification && !coalescedSourceNotification) {
        updateOpencodeDelivery(sourceNotification.id, "queued", null, null);
        enqueueSourceCompletionNotice({
          messageId: sourceNotification.id,
          messageSessionId: watch.sourceSessionId,
          sessionId: watch.sourceSessionId,
        });
      }
    } else {
      enqueueSourceCompletionNotice({
        messageId: sourceNotification.id,
        messageSessionId: watch.sourceSessionId,
        sessionId: watch.sourceSessionId,
      });
    }
  }
  updateForwardTarget(watch.sourceMessageId, sourceNotification.id, "notified");
  updateForwardStatus(watch.targetMessageId, "notified");
  updateForwardTarget(sourceNotification.id, targetNotification.id, "notified");
  stopCompletionWatch(watch.targetMessageId);
  setCompletionWatchStatus(watch.targetMessageId, "completed");
  stopForwardCompletionNotificationWatch(sourceMessageId);
  broadcastQueue(watch.sourceSessionId);
  broadcastQueue(watch.targetSessionId);
  return true;
}

export function stopForwardCompletionNotificationWatch(sourceMessageId: number): void {
  forwardCompletionWatches.delete(sourceMessageId);
  const timer = forwardCompletionTimers.get(sourceMessageId);
  if (timer) clearInterval(timer);
  forwardCompletionTimers.delete(sourceMessageId);
}

type ResumableDeliveryJob = {
  kind: "direct_user_message" | "forward_target_message";
  messageId: number;
  sessionId: string;
};

function resumableWatchForDeliveryJob(
  job: ResumableDeliveryJob,
): ResumableNotificationWatch | null {
  const message = getMessage(job.messageId);
  if (!message) return null;

  if (job.kind === "direct_user_message") {
    if (getMessageByClientId(job.sessionId, "user", `target-idle-${message.id}`)) {
      return null;
    }
    return {
      kind: "idle",
      sessionId: job.sessionId,
      triggerMessageId: message.id,
    };
  }

  if (message.completionWatchStatus === "watching") {
    const sourceMessageId =
      message.completionSourceMessageId ?? message.forwardSourceMessageId ?? message.id;
    return {
      kind: "forward_completion",
      sourceMessageId,
      sourceSessionId:
        message.completionSourceSessionId ?? message.forwardSourceSessionId ?? message.sessionId,
      targetMessageId: message.id,
      targetSessionId: job.sessionId,
    };
  }

  const sourceMessageId = message.forwardSourceMessageId ?? message.id;
  if (getMessageByClientId(job.sessionId, "user", `target-idle-${sourceMessageId}`)) {
    return null;
  }
  return {
    kind: "idle",
    sessionId: job.sessionId,
    triggerMessageId: message.id,
  };
}

function listResumableNotificationWatches(): ResumableNotificationWatch[] {
  const resumable: ResumableNotificationWatch[] = [];
  const jobKinds = ["direct_user_message", "forward_target_message"] as const;
  const succeededKinds = and(
    inArray(opencodeDeliveryJobs.kind, [...jobKinds]),
    eq(opencodeDeliveryJobs.status, "succeeded"),
  );

  const opencodeJobs = drizzleDb
    .select({
      kind: opencodeDeliveryJobs.kind,
      messageId: opencodeDeliveryJobs.messageId,
      sessionId: opencodeDeliveryJobs.opencodeSessionId,
    })
    .from(opencodeDeliveryJobs)
    .where(succeededKinds)
    .orderBy(asc(opencodeDeliveryJobs.id))
    .all();
  const claudeJobs = drizzleDb
    .select({
      kind: claudeDeliveryJobs.kind,
      messageId: claudeDeliveryJobs.messageId,
      sessionId: claudeDeliveryJobs.claudeSessionId,
    })
    .from(claudeDeliveryJobs)
    .where(
      and(
        eq(claudeDeliveryJobs.status, "succeeded"),
        inArray(claudeDeliveryJobs.kind, [...jobKinds]),
      ),
    )
    .orderBy(asc(claudeDeliveryJobs.id))
    .all();
  const cursorJobs = drizzleDb
    .select({
      kind: cursorDeliveryJobs.kind,
      messageId: cursorDeliveryJobs.messageId,
      sessionId: cursorDeliveryJobs.cursorSessionId,
    })
    .from(cursorDeliveryJobs)
    .where(
      and(
        eq(cursorDeliveryJobs.status, "succeeded"),
        inArray(cursorDeliveryJobs.kind, [...jobKinds]),
      ),
    )
    .orderBy(asc(cursorDeliveryJobs.id))
    .all();
  const codexJobs = drizzleDb
    .select({
      kind: codexDeliveryJobs.kind,
      messageId: codexDeliveryJobs.messageId,
      sessionId: codexDeliveryJobs.codexSessionId,
    })
    .from(codexDeliveryJobs)
    .where(
      and(
        eq(codexDeliveryJobs.status, "succeeded"),
        inArray(codexDeliveryJobs.kind, [...jobKinds]),
      ),
    )
    .orderBy(asc(codexDeliveryJobs.id))
    .all();

  for (const job of [...opencodeJobs, ...claudeJobs, ...cursorJobs, ...codexJobs]) {
    if (job.kind !== "direct_user_message" && job.kind !== "forward_target_message") continue;
    const watch = resumableWatchForDeliveryJob({
      kind: job.kind,
      messageId: job.messageId,
      sessionId: job.sessionId,
    });
    if (watch) resumable.push(watch);
  }
  return resumable;
}

export const NotificationWatchRepositoryLive = Layer.succeed(NotificationWatchRepository, {
  listResumable: () => Effect.sync(() => listResumableNotificationWatches()),
} satisfies NotificationWatchRepositoryService);

export const NotificationWatchSchedulerLive = Layer.succeed(NotificationWatchScheduler, {
  startIdle: (watch) =>
    Effect.sync(() => startIdleNotificationWatch({ ...watch, seenWorking: true })),
  startForwardCompletion: (watch) =>
    Effect.sync(() => startForwardCompletionNotificationWatch({ ...watch, seenWorking: true })),
} satisfies NotificationWatchSchedulerService);

export const NotificationWatchResumeLive = Layer.mergeAll(
  NotificationWatchRepositoryLive,
  NotificationWatchSchedulerLive,
);

export function resumeNotificationWatchesEffect(): Effect.Effect<
  void,
  never,
  NotificationWatchRepositoryService | NotificationWatchSchedulerService
> {
  return Effect.gen(function* () {
    const repository = yield* NotificationWatchRepository;
    const scheduler = yield* NotificationWatchScheduler;
    const watches = yield* repository.listResumable();
    for (const watch of watches) {
      if (watch.kind === "idle") {
        yield* scheduler.startIdle(watch);
      } else {
        yield* scheduler.startForwardCompletion(watch);
      }
    }
  });
}

export function resumeNotificationWatches(): void {
  Effect.runSync(
    resumeNotificationWatchesEffect().pipe(Effect.provide(NotificationWatchResumeLive)),
  );
}

export function clearForwardCompletionNotificationWatches(): void {
  for (const timer of forwardCompletionTimers.values()) clearInterval(timer);
  forwardCompletionTimers.clear();
  forwardCompletionWatches.clear();
  for (const timer of idleNotificationTimers.values()) clearInterval(timer);
  idleNotificationTimers.clear();
  idleNotificationWatches.clear();
}
