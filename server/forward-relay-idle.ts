import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { RESUMABLE_COMPLETION_WATCH_STATUSES } from "@say-to-me/completion-watch/workflow";
import { drizzleDb } from "./db/index.ts";
import { messages as messagesTable, routines } from "./db/drizzle-schema.ts";
import { DbMessage, validateDb, type DbMessage as DbMessageRow } from "./db/schemas.ts";
import { messageSelectColumns } from "./messages.ts";
import { stopForwardCompletionNotificationWatch } from "./notifications.ts";
import { stopCompletionWatch } from "./opencode/completion-watch.ts";
import { ensureSession } from "./sessions.ts";

export type CreateForwardRelayInput = {
  sessionId: string;
  targetSessionId: string;
  /** Source message text when no idle wait is armed (must not promise a notify). */
  sourceText: string;
  /**
   * Source message text when an idle wait is created or rebound.
   * Falls back to `sourceText` when omitted.
   */
  armedSourceText?: string | null;
  targetText: string;
  links: string | null;
  sourceSessionRefs: string;
  targetSessionRefs: string;
  clientMessageId: string | null;
  notifyOnCompletion: boolean;
};

export type CreateForwardRelayResult = {
  sourceMessage: DbMessageRow;
  targetMessage: DbMessageRow;
  /** True when a session_idle wait was created or rebound for this relay. */
  idleWaitArmed: boolean;
};

/**
 * Insert source + target forward messages and (when requested) the session_idle
 * routine in one write transaction so a routine-create failure cannot leave an
 * orphan watching target with no cancellable wait.
 *
 * One active idle route per owner→target: a later notify rebinds the existing
 * wait to the new source message (and arms the new target watch) instead of
 * stacking duplicates or permanently swallowing notify behind a stuck wait.
 */
export function createForwardRelayWithOptionalIdleWait(
  input: CreateForwardRelayInput,
  options?: {
    /** Test hook: throw after messages are staged to prove the transaction rolls back. */
    failBeforeRoutineCommit?: () => void;
  },
): CreateForwardRelayResult {
  ensureSession(input.sessionId);
  ensureSession(input.targetSessionId);

  let previousSourceMessageId: number | null = null;

  const result = drizzleDb.transaction((tx) => {
    const existingIdleWait = input.notifyOnCompletion
      ? tx
          .select({
            id: routines.id,
            sourceMessageId: sql<
              number | null
            >`json_extract(${routines.trigger}, '$.sourceMessageId')`,
          })
          .from(routines)
          .where(
            and(
              eq(routines.ownerSessionId, input.sessionId),
              eq(routines.triggerKind, "session_idle"),
              inArray(routines.status, ["active", "paused", "firing"]),
              sql`json_extract(${routines.trigger}, '$.targetSessionId') = ${input.targetSessionId}`,
            ),
          )
          .orderBy(asc(routines.id))
          .limit(1)
          .get()
      : null;

    const existingSourceMessageId =
      existingIdleWait && typeof existingIdleWait.sourceMessageId === "number"
        ? existingIdleWait.sourceMessageId
        : null;

    // Always arm when notify is requested: create a new wait or rebind the existing one.
    const armIdleWait = input.notifyOnCompletion;
    const sourceText =
      armIdleWait && input.armedSourceText != null && input.armedSourceText !== ""
        ? input.armedSourceText
        : input.sourceText;

    const sourceMessage = validateDb(
      DbMessage,
      tx
        .insert(messagesTable)
        .values({
          sessionId: input.sessionId,
          text: sourceText,
          author: "user",
          status: "received",
          links: input.links,
          sessionRefs: input.sourceSessionRefs,
          clientMessageId: input.clientMessageId,
          forwardRole: "source",
          forwardSourceSessionId: input.sessionId,
          forwardSourceMessageId: null,
          forwardTargetSessionId: input.targetSessionId,
          forwardTargetMessageId: null,
          forwardStatus: "pending",
        })
        .returning(messageSelectColumns)
        .get(),
      "insertForwardSource",
    );

    const targetMessage = validateDb(
      DbMessage,
      tx
        .insert(messagesTable)
        .values({
          sessionId: input.targetSessionId,
          text: input.targetText,
          author: "user",
          status: "received",
          links: input.links,
          sessionRefs: input.targetSessionRefs,
          clientMessageId: null,
          forwardRole: "target",
          forwardSourceSessionId: input.sessionId,
          forwardSourceMessageId: sourceMessage.id,
          forwardTargetSessionId: input.targetSessionId,
          forwardTargetMessageId: null,
          forwardStatus: "pending",
          completionWatchStatus: armIdleWait ? "watching" : null,
          completionSourceSessionId: armIdleWait ? input.sessionId : null,
          completionSourceMessageId: armIdleWait ? sourceMessage.id : null,
        })
        .returning(messageSelectColumns)
        .get(),
      "insertForwardTarget",
    );

    tx.update(messagesTable)
      .set({ forwardTargetMessageId: targetMessage.id, forwardStatus: "pending" })
      .where(eq(messagesTable.id, sourceMessage.id))
      .run();
    tx.update(messagesTable)
      .set({ forwardTargetMessageId: targetMessage.id, forwardStatus: "queued" })
      .where(eq(messagesTable.id, sourceMessage.id))
      .run();
    tx.update(messagesTable)
      .set({ forwardStatus: "queued" })
      .where(eq(messagesTable.id, targetMessage.id))
      .run();

    if (armIdleWait) {
      options?.failBeforeRoutineCommit?.();
      const trigger = {
        kind: "session_idle" as const,
        targetSessionId: input.targetSessionId,
        sourceMessageId: sourceMessage.id,
        afterWorkSeen: true,
      };

      if (existingIdleWait) {
        // Disarm watches tied to the previous source so a stuck wait cannot block forever.
        if (existingSourceMessageId != null) {
          previousSourceMessageId = existingSourceMessageId;
          const oldTargets = tx
            .select({ id: messagesTable.id })
            .from(messagesTable)
            .where(
              and(
                eq(messagesTable.completionSourceMessageId, existingSourceMessageId),
                inArray(messagesTable.completionWatchStatus, [
                  ...RESUMABLE_COMPLETION_WATCH_STATUSES,
                ]),
              ),
            )
            .all();
          for (const row of oldTargets) {
            tx.update(messagesTable)
              .set({ completionWatchStatus: "cancelled", completionWatchNextCheckAt: 0 })
              .where(eq(messagesTable.id, row.id))
              .run();
          }
        }
        tx.update(routines)
          .set({
            trigger: JSON.stringify(trigger),
            title: `Wait for ${input.targetSessionId}`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(routines.id, existingIdleWait.id))
          .run();
      } else {
        tx.insert(routines)
          .values({
            ownerSessionId: input.sessionId,
            title: `Wait for ${input.targetSessionId}`,
            triggerKind: "session_idle",
            trigger: JSON.stringify(trigger),
            action: JSON.stringify({ kind: "notify_owner" }),
            nextFireAt: null,
          })
          .run();
      }
    }

    const source = validateDb(
      DbMessage,
      tx
        .select(messageSelectColumns)
        .from(messagesTable)
        .where(eq(messagesTable.id, sourceMessage.id))
        .get(),
      "forwardRelaySource",
    );
    const target = validateDb(
      DbMessage,
      tx
        .select(messageSelectColumns)
        .from(messagesTable)
        .where(eq(messagesTable.id, targetMessage.id))
        .get(),
      "forwardRelayTarget",
    );
    return {
      sourceMessage: source,
      targetMessage: target,
      idleWaitArmed: armIdleWait,
    };
  });

  if (previousSourceMessageId != null) {
    for (const message of drizzleDb
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eq(messagesTable.completionSourceMessageId, previousSourceMessageId))
      .all()) {
      stopCompletionWatch(message.id);
    }
    stopForwardCompletionNotificationWatch(previousSourceMessageId);
  }

  return result;
}
