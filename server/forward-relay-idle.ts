import { eq } from "drizzle-orm";
import { drizzleDb } from "./db/index.ts";
import { messages as messagesTable, routines } from "./db/drizzle-schema.ts";
import { DbMessage, validateDb, type DbMessage as DbMessageRow } from "./db/schemas.ts";
import { messageSelectColumns } from "./messages.ts";
import { ensureSession } from "./sessions.ts";

export type CreateForwardRelayInput = {
  sessionId: string;
  targetSessionId: string;
  sourceText: string;
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
};

/**
 * Insert source + target forward messages and (when requested) the session_idle
 * routine in one write transaction so a routine-create failure cannot leave an
 * orphan watching target with no cancellable wait.
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

  return drizzleDb.transaction((tx) => {
    const sourceMessage = validateDb(
      DbMessage,
      tx
        .insert(messagesTable)
        .values({
          sessionId: input.sessionId,
          text: input.sourceText,
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
          completionWatchStatus: input.notifyOnCompletion ? "watching" : null,
          completionSourceSessionId: input.notifyOnCompletion ? input.sessionId : null,
          completionSourceMessageId: input.notifyOnCompletion ? sourceMessage.id : null,
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

    if (input.notifyOnCompletion) {
      options?.failBeforeRoutineCommit?.();
      const trigger = {
        kind: "session_idle" as const,
        targetSessionId: input.targetSessionId,
        sourceMessageId: sourceMessage.id,
        afterWorkSeen: true,
      };
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
    return { sourceMessage: source, targetMessage: target };
  });
}
