import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { broadcastQueue } from "./broadcast.ts";
import { drizzleDb } from "./db/index.ts";
import {
  claudeDeliveryJobs,
  codexDeliveryJobs,
  cursorDeliveryJobs,
  grokDeliveryJobs,
  messages as messagesTable,
  opencodeDeliveryJobs,
} from "./db/drizzle-schema.ts";
import { TARGET_IDLE_NOTICE_TEXT } from "@say-to-me/session-utils/idle-notices";
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
import { promptReachedTarget, stopCompletionWatch } from "./opencode/completion-watch.ts";
import {
  DEFAULT_COMPLETION_WATCH_QUIET_MS,
  isLiveCompletionWatchStatus,
} from "@say-to-me/completion-watch/workflow";
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

function externalCliQuietWindowMs(): number {
  const raw = process.env.SAY_TO_ME_COMPLETION_WATCH_QUIET_MS;
  if (raw != null && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_COMPLETION_WATCH_QUIET_MS;
}

function quietWindowMsForSession(sessionId: string): number {
  const backend = detectSessionBackend(sessionId);
  // Cursor idle is `cursor-agent -p` process-end, not a second clock after close.
  if (backend === "opencode" || backend === "cursor") return 0;
  return externalCliQuietWindowMs();
}

/**
 * True when the delivery worker already posted the spoken idle ding for this
 * trigger (complete-with-reply inserts it directly). The in-memory watch then
 * stands down instead of posting a second "Session is now idle.".
 */
function hasAgentIdleNoticeSince(sessionId: string, afterMessageId: number): boolean {
  const row = drizzleDb
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        eq(messagesTable.author, "agent"),
        eq(messagesTable.text, TARGET_IDLE_NOTICE_TEXT),
        gt(messagesTable.id, afterMessageId),
      ),
    )
    .orderBy(desc(messagesTable.id))
    .limit(1)
    .get();
  return row != null;
}

type ForwardCompletionWatch = {
  sourceMessageId: number;
  sourceSessionId: string;
  targetMessageId: number;
  targetSessionId: string;
  seenWorking: boolean;
  quietSince: number | null;
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

function sourceIdleNotificationText(_targetSessionId: string, _targetMessageId: number): string {
  return "Session is now idle.";
}

export function hasForwardCompletionNotificationWatch(sourceMessageId: number): boolean {
  return forwardCompletionWatches.has(sourceMessageId);
}

type IdleNotificationWatch = {
  sessionId: string;
  triggerMessageId: number;
  seenWorking: boolean;
  quietSince: number | null;
};

const idleNotificationWatches = new Map<number, IdleNotificationWatch>();
const idleNotificationTimers = new Map<number, ReturnType<typeof setInterval>>();

function ensureTargetIdleNotification(sessionId: string, clientMessageId: string) {
  const existing = getMessageByClientId(sessionId, "user", clientMessageId);
  if (existing) return existing;
  return insertMessageRow({
    sessionId,
    text: "Session is now idle.",
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
  // Terminal or in-flight delivery: do not start another prompt for the same message.
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
}: Omit<IdleNotificationWatch, "seenWorking" | "quietSince"> & { seenWorking?: boolean }): void {
  const existing = idleNotificationWatches.get(triggerMessageId);
  idleNotificationWatches.set(triggerMessageId, {
    sessionId,
    triggerMessageId,
    seenWorking: existing?.seenWorking || seenWorking,
    quietSince: existing?.quietSince ?? null,
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
    idleNotificationWatches.set(triggerMessageId, {
      ...watch,
      seenWorking: true,
      quietSince: null,
    });
    return false;
  }
  if (status !== "idle" || !watch.seenWorking) return false;
  // The worker's own reply ding counts as the idle notice; never post twice.
  if (hasAgentIdleNoticeSince(watch.sessionId, watch.triggerMessageId)) {
    stopIdleNotificationWatch(triggerMessageId);
    broadcastQueue(watch.sessionId);
    return true;
  }
  const quietMs = quietWindowMsForSession(watch.sessionId);
  if (quietMs > 0) {
    const now = Date.now();
    if (watch.quietSince == null) {
      idleNotificationWatches.set(triggerMessageId, { ...watch, quietSince: now });
      return false;
    }
    if (now - watch.quietSince < quietMs) return false;
  }

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
}: Omit<StartForwardCompletionNotificationWatchOptions, "seenWorking" | "quietSince"> & {
  seenWorking?: boolean;
}): void {
  const existing = forwardCompletionWatches.get(sourceMessageId);
  forwardCompletionWatches.set(sourceMessageId, {
    sourceMessageId,
    sourceSessionId,
    targetMessageId,
    targetSessionId,
    seenWorking: existing?.seenWorking || seenWorking,
    quietSince: existing?.quietSince ?? null,
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
    forwardCompletionWatches.set(sourceMessageId, {
      ...watch,
      seenWorking: true,
      quietSince: null,
    });
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
  // Same invariant as the completion-watch tick: an idle read only means the
  // relay finished if the prompt actually reached the target in the first place.
  if (!promptReachedTarget(getMessage(watch.targetMessageId)?.opencodeDeliveryStatus ?? null)) {
    return false;
  }
  const quietMs = quietWindowMsForSession(watch.targetSessionId);
  if (quietMs > 0) {
    const now = Date.now();
    if (watch.quietSince == null) {
      forwardCompletionWatches.set(sourceMessageId, { ...watch, quietSince: now });
      return false;
    }
    if (now - watch.quietSince < quietMs) return false;
  }

  const {
    completeSessionIdleRoutine,
    findActiveSessionIdleRoutineBySourceMessageId,
    findSessionIdleRoutineBySourceMessageId,
  } = await import("./routines.ts");
  const idleRoutine = findActiveSessionIdleRoutineBySourceMessageId(sourceMessageId);
  if (!idleRoutine) {
    const existing = findSessionIdleRoutineBySourceMessageId(sourceMessageId);
    if (existing?.status === "cancelled") {
      // Cancel wait — never notify.
      stopForwardCompletionNotificationWatch(sourceMessageId);
      setCompletionWatchStatus(watch.targetMessageId, "cancelled");
      stopCompletionWatch(watch.targetMessageId);
      return false;
    }
    // fired/failed/legacy: fall through so existing notice coalescing stays idempotent.
  }

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
  if (idleRoutine) {
    completeSessionIdleRoutine({
      routineId: idleRoutine.id,
      messageId: sourceNotification.id,
      targetSessionId: watch.targetSessionId,
      targetMessageId: watch.targetMessageId,
      sourceMessageId: watch.sourceMessageId,
      reason: "idle",
    });
  }
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
    // A worker-posted reply ding already served as this message's idle notice.
    if (hasAgentIdleNoticeSince(job.sessionId, message.id)) {
      return null;
    }
    return {
      kind: "idle",
      sessionId: job.sessionId,
      triggerMessageId: message.id,
    };
  }

  if (isLiveCompletionWatchStatus(message.completionWatchStatus)) {
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
  if (hasAgentIdleNoticeSince(job.sessionId, message.id)) {
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
  const grokJobs = drizzleDb
    .select({
      kind: grokDeliveryJobs.kind,
      messageId: grokDeliveryJobs.messageId,
      sessionId: grokDeliveryJobs.grokSessionId,
    })
    .from(grokDeliveryJobs)
    .where(
      and(eq(grokDeliveryJobs.status, "succeeded"), inArray(grokDeliveryJobs.kind, [...jobKinds])),
    )
    .orderBy(asc(grokDeliveryJobs.id))
    .all();

  for (const job of [...opencodeJobs, ...claudeJobs, ...cursorJobs, ...codexJobs, ...grokJobs]) {
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
