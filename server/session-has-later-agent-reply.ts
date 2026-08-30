import { and, asc, eq, gt, lt } from "drizzle-orm";
import { isIdleNoticeText } from "@say-to-me/session-utils/idle-notices";
import { drizzleDb } from "./db/index.ts";
import { messages as messagesTable } from "./db/drizzle-schema.ts";

function sqliteUtcFromUnixMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * True when this delivery, not some later turn in the same session, produced
 * an agent reply. A higher message id is not proof: leftover HTTP, an idle
 * watch row, or the next prompt's answer must not mark a failed job sent.
 */
export function sessionHasLaterAgentReply(
  message: { id: number; sessionId: string },
  promptDispatchedAt: number,
): boolean {
  const dispatchedAt = sqliteUtcFromUnixMs(promptDispatchedAt);
  const laterAgents = drizzleDb
    .select({
      id: messagesTable.id,
      text: messagesTable.text,
      parentId: messagesTable.parentId,
      createdAt: messagesTable.createdAt,
      opencodeDeliveryStatus: messagesTable.opencodeDeliveryStatus,
    })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, message.sessionId),
        eq(messagesTable.author, "agent"),
        gt(messagesTable.id, message.id),
      ),
    )
    .orderBy(asc(messagesTable.id))
    .all();

  for (const row of laterAgents) {
    if (row.opencodeDeliveryStatus === "ui_only") continue;
    if (isIdleNoticeText(row.text)) continue;
    if (row.parentId === message.id) return true;
    if (row.createdAt < dispatchedAt) continue;
    const interveningUsers = drizzleDb
      .select({
        id: messagesTable.id,
        text: messagesTable.text,
        opencodeDeliveryStatus: messagesTable.opencodeDeliveryStatus,
      })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.sessionId, message.sessionId),
          eq(messagesTable.author, "user"),
          gt(messagesTable.id, message.id),
          lt(messagesTable.id, row.id),
        ),
      )
      .all();
    const hasLaterUserTurn = interveningUsers.some(
      (user) => user.opencodeDeliveryStatus !== "ui_only" && !isIdleNoticeText(user.text),
    );
    if (hasLaterUserTurn) continue;
    return true;
  }
  return false;
}
