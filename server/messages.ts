import { type as arktype } from "arktype";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  like,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { maxTotalMessages } from "./config.ts";
import { messages as messagesTable } from "./db/drizzle-schema.ts";
import { drizzleDb, drizzleSqlite } from "./db/index.ts";
import { DbCount, DbMessage, validateDb } from "./db/schemas.ts";
import { claimQueuedAgentSlot } from "./messages-queue-cap-claim.ts";
import {
  attachmentsByMessageId,
  listAttachmentsForMessage,
  serializeAttachment,
} from "./images.ts";
import { extractSessionMentions } from "../src/session-mentions.ts";
import { JsonStringArray, JsonUnknownArray, safeJsonParse } from "@say-to-me/runtime-validation";
import type { OpenCodeStatus } from "../src/types.ts";
import { getCachedOpenCodeStatus } from "./opencode/cache.ts";
import { inspectOpenCodeActivityRuntime } from "./opencode/activity-routes.ts";
import { listSessions } from "./sessions.ts";
import { extraMarkdownHtmlField } from "./markdown/extra-markdown-html.ts";

export const messageSelectColumns = {
  id: messagesTable.id,
  sessionId: messagesTable.sessionId,
  text: messagesTable.text,
  extraMarkdown: messagesTable.extraMarkdown,
  pushNotificationText: messagesTable.pushNotificationText,
  status: messagesTable.status,
  pinned: messagesTable.pinned,
  author: messagesTable.author,
  parentId: messagesTable.parentId,
  attachedSessionId: messagesTable.attachedSessionId,
  opencodeDeliveryStatus: messagesTable.opencodeDeliveryStatus,
  opencodeDeliveryError: messagesTable.opencodeDeliveryError,
  opencodeMessageId: messagesTable.opencodeMessageId,
  clientMessageId: messagesTable.clientMessageId,
  links: messagesTable.links,
  sessionRefs: messagesTable.sessionRefs,
  mergedIntoMessageId: messagesTable.mergedIntoMessageId,
  forwardRole: messagesTable.forwardRole,
  forwardSourceSessionId: messagesTable.forwardSourceSessionId,
  forwardSourceMessageId: messagesTable.forwardSourceMessageId,
  forwardTargetSessionId: messagesTable.forwardTargetSessionId,
  forwardTargetMessageId: messagesTable.forwardTargetMessageId,
  forwardStatus: messagesTable.forwardStatus,
  completionWatchStatus: messagesTable.completionWatchStatus,
  completionWatchWorkSeen: messagesTable.completionWatchWorkSeen,
  completionWatchNextCheckAt: messagesTable.completionWatchNextCheckAt,
  completionSourceSessionId: messagesTable.completionSourceSessionId,
  completionSourceMessageId: messagesTable.completionSourceMessageId,
  completionTargetNotificationMessageId: messagesTable.completionTargetNotificationMessageId,
  completionSourceNotificationMessageId: messagesTable.completionSourceNotificationMessageId,
  paseoAuthor: messagesTable.paseoAuthor,
  paseoAuthorName: messagesTable.paseoAuthorName,
  createdAt: messagesTable.createdAt,
};

const playableStatuses = ["queued", "pending", "speaking"];
const StoredSessionReference = arktype({ id: "string", "alias?": "string | null" });

export type SessionReferenceInput = {
  id: string;
  alias: string | null;
};

export type MessageSessionReference = {
  id: string;
  alias: string | null;
  title: string | null;
  summary: string | null;
  summaryUpdatedAt: string | null;
  waitingState: string | null;
  latestMessageAuthor: "agent" | "user" | null;
  latestMessageText: string | null;
  state: string | null;
  projectName: string | null;
  workspaceId: string | null;
  latestActivity: string | null;
  messageCount: number | null;
  opencodeStatus: OpenCodeStatus | null;
  opencodeActivitySnippet: string | null;
};

function latestMessageForSession(sessionId: string): DbMessage | null {
  const row = drizzleDb
    .select(messageSelectColumns)
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, sessionId))
    .orderBy(desc(messagesTable.id))
    .limit(1)
    .get();
  return row ? validateDb(DbMessage, row, "latestMessageForSession") : null;
}

function latestLine(text: string): string {
  return (
    text
      .trim()
      .split("\n")
      .findLast((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

function isIdleSystemMessage(text: string): boolean {
  return /^<say-to-me-system>[^<]+ is idle now<\/say-to-me-system>$/.test(text.trim());
}

function isSayToMeSystemMessage(text: string): boolean {
  return /^<say-to-me-system>[\s\S]*<\/say-to-me-system>$/.test(text.trim());
}

function summarizeSessionCard(
  session: ReturnType<typeof listSessions>[number],
): Pick<
  MessageSessionReference,
  "summary" | "summaryUpdatedAt" | "waitingState" | "latestMessageAuthor" | "latestMessageText"
> {
  const latest = latestMessageForSession(session.id);
  if (!latest) {
    return {
      summary: "No activity yet.",
      summaryUpdatedAt: session.updatedAt ?? null,
      waitingState: "unknown",
      latestMessageAuthor: null,
      latestMessageText: null,
    };
  }

  const line = latestLine(latest.text);
  const latestFields = {
    latestMessageAuthor: latest.author,
    latestMessageText: line || latest.text,
  };
  if (isIdleSystemMessage(latest.text)) {
    return {
      summary: line ? `Idle notification: ${line}` : "Idle after the last notification.",
      summaryUpdatedAt: latest.createdAt,
      waitingState: "can_continue",
      ...latestFields,
    };
  }

  if (latest.author === "user") {
    if (
      latest.opencodeDeliveryStatus === "failed" ||
      latest.opencodeDeliveryStatus === "cli_timed_out"
    ) {
      return {
        summary: "Needs attention: the last message failed to reach OpenCode.",
        summaryUpdatedAt: latest.createdAt,
        waitingState: "blocked",
        ...latestFields,
      };
    }
    if (latest.opencodeDeliveryStatus === "pending" || latest.opencodeDeliveryStatus === "queued") {
      return {
        summary: "Working on the latest user message.",
        summaryUpdatedAt: latest.createdAt,
        waitingState: "working",
        ...latestFields,
      };
    }
    return {
      summary: line ? `User asked: ${line}` : "Waiting for the agent to respond.",
      summaryUpdatedAt: latest.createdAt,
      waitingState: "working",
      ...latestFields,
    };
  }

  if (line.endsWith("?")) {
    return {
      summary: line ? `Needs you: ${line}` : "Needs your answer.",
      summaryUpdatedAt: latest.createdAt,
      waitingState: "needs_answer",
      ...latestFields,
    };
  }
  return {
    summary: line ? `Last update: ${line}` : "Idle after the last agent update.",
    summaryUpdatedAt: latest.createdAt,
    waitingState: "can_continue",
    ...latestFields,
  };
}

/** Queued agent messages in one session (per-session voice queue cap). */
export function getQueuedCountForSession(sessionId: string): number {
  const row = validateDb(
    DbCount,
    drizzleDb
      .select({ count: sql<number>`COUNT(*)` })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.sessionId, sessionId),
          eq(messagesTable.author, "agent"),
          eq(messagesTable.status, "queued"),
        ),
      )
      .get(),
    "queuedMessageCountForSession",
  );
  return row.count;
}

export type InsertQueuedAgentMessageInput = {
  sessionId: string;
  text: string;
  extraMarkdown: string | null;
  pushNotificationText?: string | null;
  links: string | null;
  sessionRefs: string | null;
  clientMessageId: string | null;
  completionWatchStatus?: string | null;
  completionSourceSessionId?: string | null;
  completionSourceMessageId?: number | null;
  overflow: "force" | null;
  paseoAuthor?: string | null;
  paseoAuthorName?: string | null;
};

export type InsertQueuedAgentMessageResult =
  | { ok: true; message: DbMessage; existing: boolean }
  | { ok: false; error: string };

/**
 * Atomically claim a per-session queue slot and insert a queued agent message.
 * Count + optional eviction skip + insert run in one BEGIN IMMEDIATE write transaction
 * so concurrent connections cannot both pass the cap or double-evict the same row.
 * Idempotent clientMessageId lookups happen inside that same transaction.
 */
export function insertQueuedAgentMessageClaimingCap(
  input: InsertQueuedAgentMessageInput,
): InsertQueuedAgentMessageResult {
  const claimed = claimQueuedAgentSlot(drizzleSqlite, input);
  if (!claimed.ok) return claimed;
  const message = getMessage(claimed.id);
  if (!message) {
    throw new Error(`Queued agent message ${claimed.id} missing after atomic claim.`);
  }
  return { ok: true, message, existing: claimed.existing };
}

export function parseLinks(raw: string | null): string[] | null {
  if (!raw) return null;
  const parsed = safeJsonParse(JsonStringArray, raw);
  return parsed;
}

export function parseSessionRefs(raw: string | null): SessionReferenceInput[] {
  if (!raw) return [];
  const parsed = safeJsonParse(JsonUnknownArray, raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): SessionReferenceInput[] => {
    if (typeof item === "string") return [{ id: item, alias: null }];
    const reference = StoredSessionReference(item);
    if (reference instanceof arktype.errors) return [];
    return [
      {
        id: reference.id,
        alias: reference.alias ?? null,
      },
    ];
  });
}

function extractSessionRefs(text: string): SessionReferenceInput[] {
  // System notices embed session ids as narrative text, not card references.
  if (isSayToMeSystemMessage(text)) return [];
  return extractSessionMentions(text);
}

function buildSessionReferenceIndex(): Map<string, MessageSessionReference> {
  return new Map(
    listSessions().map((session) => [
      session.id,
      {
        id: session.id,
        alias: session.alias ?? null,
        title: session.opencodeTitle || null,
        ...summarizeSessionCard(session),
        state: session.state ?? null,
        projectName: session.opencodeProjectName ?? null,
        workspaceId: session.opencodeWorkspaceId ?? null,
        latestActivity: session.updatedAt ?? null,
        messageCount: session.messageCount ?? null,
        opencodeStatus: getCachedOpenCodeStatus(session.id),
        opencodeActivitySnippet: (() => {
          const rt = inspectOpenCodeActivityRuntime(session.id);
          const snippet = rt?.latestActivitySnapshot?.latestOutputSnippet;
          return typeof snippet === "string" && snippet.trim() ? snippet.trim() : null;
        })(),
      },
    ]),
  );
}

function resolveMessageSessions(
  message: DbMessage,
  sessionIndex = buildSessionReferenceIndex(),
): MessageSessionReference[] {
  const refs = [...parseSessionRefs(message.sessionRefs), ...extractSessionRefs(message.text)];
  const refsById = new Map<string, SessionReferenceInput>();
  for (const ref of refs) {
    if (!refsById.has(ref.id)) refsById.set(ref.id, ref);
  }
  return [...refsById.values()].map((ref) => {
    const indexed = sessionIndex.get(ref.id);
    return (
      (indexed && { ...indexed, alias: ref.alias || indexed.alias }) ?? {
        id: ref.id,
        alias: ref.alias,
        title: null,
        summary: null,
        summaryUpdatedAt: null,
        waitingState: null,
        latestMessageAuthor: null,
        latestMessageText: null,
        state: null,
        projectName: null,
        workspaceId: null,
        latestActivity: null,
        messageCount: null,
        opencodeStatus: null,
        opencodeActivitySnippet: null,
      }
    );
  });
}

export function getMessage(id: number): DbMessage | null {
  const row = drizzleDb
    .select(messageSelectColumns)
    .from(messagesTable)
    .where(eq(messagesTable.id, id))
    .limit(1)
    .get();
  if (row == null) return null;
  return validateDb(DbMessage, row, "getMessage");
}

export function getLastUserMessage(sessionId: string): DbMessage | null {
  const row = drizzleDb
    .select(messageSelectColumns)
    .from(messagesTable)
    .where(and(eq(messagesTable.sessionId, sessionId), eq(messagesTable.author, "user")))
    .orderBy(desc(messagesTable.id))
    .limit(1)
    .get();
  return row ? validateDb(DbMessage, row, "getLastUserMessage") : null;
}

export function listUserMessagesAfter(
  sessionId: string,
  since: number,
  limit: number,
): DbMessage[] {
  return drizzleDb
    .select(messageSelectColumns)
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        eq(messagesTable.author, "user"),
        gt(messagesTable.id, since),
      ),
    )
    .orderBy(asc(messagesTable.id))
    .limit(limit)
    .all()
    .map((row) => validateDb(DbMessage, row, "listUserMessagesAfter"));
}

export function getMessageByClientId(
  sessionId: string,
  author: "agent" | "user",
  clientMessageId: string,
): DbMessage | null {
  const row = drizzleDb
    .select(messageSelectColumns)
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        eq(messagesTable.author, author),
        eq(messagesTable.clientMessageId, clientMessageId),
      ),
    )
    .orderBy(asc(messagesTable.id))
    .limit(1)
    .get();
  return row ? validateDb(DbMessage, row, "getMessageByClientId") : null;
}

export function insertMessageRow({
  sessionId,
  text,
  extraMarkdown,
  pushNotificationText = null,
  author,
  status,
  parentId = null,
  links,
  sessionRefs,
  clientMessageId,
  completionWatchStatus = null,
  completionSourceSessionId = null,
  completionSourceMessageId = null,
  paseoAuthor = null,
  paseoAuthorName = null,
}: {
  sessionId: string;
  text: string;
  extraMarkdown: string | null;
  pushNotificationText?: string | null;
  author: "agent" | "user";
  status: string;
  parentId?: number | null;
  links: string | null;
  sessionRefs: string | null;
  clientMessageId: string | null;
  completionWatchStatus?: string | null;
  completionSourceSessionId?: string | null;
  completionSourceMessageId?: number | null;
  paseoAuthor?: string | null;
  paseoAuthorName?: string | null;
}): DbMessage {
  return validateDb(
    DbMessage,
    drizzleDb
      .insert(messagesTable)
      .values({
        sessionId,
        text,
        extraMarkdown,
        pushNotificationText,
        author,
        status,
        parentId,
        links,
        sessionRefs,
        clientMessageId,
        completionWatchStatus,
        completionSourceSessionId,
        completionSourceMessageId,
        paseoAuthor,
        paseoAuthorName,
      })
      .returning(messageSelectColumns)
      .get(),
    "insertMessage",
  );
}

export function insertReplyMessage(sessionId: string, text: string, parentId: number): DbMessage {
  return validateDb(
    DbMessage,
    drizzleDb
      .insert(messagesTable)
      .values({ sessionId, text, status: "received", author: "user", parentId })
      .returning(messageSelectColumns)
      .get(),
    "insertMessage",
  );
}

export function insertForwardMessageRow({
  sessionId,
  text,
  author,
  status,
  links = null,
  sessionRefs,
  clientMessageId,
  forwardRole,
  forwardSourceSessionId,
  forwardSourceMessageId,
  forwardTargetSessionId,
  forwardTargetMessageId,
  forwardStatus,
  completionWatchStatus = null,
  completionSourceSessionId = null,
  completionSourceMessageId = null,
}: {
  sessionId: string;
  text: string;
  author: "agent" | "user";
  status: string;
  links?: string | null;
  sessionRefs: string | null;
  clientMessageId: string | null;
  forwardRole: string;
  forwardSourceSessionId: string;
  forwardSourceMessageId: number | null;
  forwardTargetSessionId: string;
  forwardTargetMessageId: number | null;
  forwardStatus: string;
  completionWatchStatus?: string | null;
  completionSourceSessionId?: string | null;
  completionSourceMessageId?: number | null;
}): DbMessage {
  return validateDb(
    DbMessage,
    drizzleDb
      .insert(messagesTable)
      .values({
        sessionId,
        text,
        author,
        status,
        links,
        sessionRefs,
        clientMessageId,
        forwardRole,
        forwardSourceSessionId,
        forwardSourceMessageId,
        forwardTargetSessionId,
        forwardTargetMessageId,
        forwardStatus,
        completionWatchStatus,
        completionSourceSessionId,
        completionSourceMessageId,
      })
      .returning(messageSelectColumns)
      .get(),
    forwardRole === "source" ? "insertForwardSource" : "insertForwardTarget",
  );
}

export function listQueuedOpencodeDeliveries(sessionId: string): DbMessage[] {
  return drizzleDb
    .select(messageSelectColumns)
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        eq(messagesTable.author, "user"),
        inArray(messagesTable.opencodeDeliveryStatus, ["queued", "failed"]),
      ),
    )
    .orderBy(asc(messagesTable.id))
    .all()
    .map((row) => validateDb(DbMessage, row, "queuedOpencodeDeliveries"));
}

export function updateOpencodeDelivery(
  messageId: number,
  status: string,
  error: string | null,
  opencodeMessageId: string | null,
): void {
  drizzleDb
    .update(messagesTable)
    .set({
      opencodeDeliveryStatus: status,
      opencodeDeliveryError: error,
      opencodeMessageId,
    })
    .where(eq(messagesTable.id, messageId))
    .run();
}

export function getExistingForwardIdleNotification(
  sourceSessionId: string,
  targetSessionId: string,
): DbMessage | null {
  const row = drizzleDb
    .select(messageSelectColumns)
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sourceSessionId),
        eq(messagesTable.author, "user"),
        inArray(messagesTable.opencodeDeliveryStatus, ["queued", "pending"]),
        eq(messagesTable.forwardRole, "target"),
        eq(messagesTable.forwardSourceSessionId, targetSessionId),
        eq(messagesTable.forwardTargetSessionId, sourceSessionId),
      ),
    )
    .orderBy(desc(messagesTable.id))
    .limit(1)
    .get();
  return row ? validateDb(DbMessage, row, "existingForwardIdleNotification") : null;
}

export function setMessageMergedInto(messageId: number, mergedIntoMessageId: number): void {
  drizzleDb
    .update(messagesTable)
    .set({ mergedIntoMessageId, opencodeDeliveryStatus: null })
    .where(eq(messagesTable.id, messageId))
    .run();
}

export function updateMessageText(messageId: number, text: string): void {
  drizzleDb.update(messagesTable).set({ text }).where(eq(messagesTable.id, messageId)).run();
}

export function listQueuedSourceCompletionNotifications(
  sourceSessionId: string,
  targetSessionId: string,
): DbMessage[] {
  return drizzleDb
    .select(messageSelectColumns)
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sourceSessionId),
        eq(messagesTable.author, "user"),
        eq(messagesTable.forwardRole, "source"),
        eq(messagesTable.forwardTargetSessionId, targetSessionId),
        eq(messagesTable.forwardStatus, "completed"),
        eq(messagesTable.opencodeDeliveryStatus, "queued"),
      ),
    )
    .orderBy(desc(messagesTable.id))
    .all()
    .map((row) => validateDb(DbMessage, row, "queuedSourceCompletionNotifications"));
}

export function listActiveCompletionWatches(sessionId?: string): DbMessage[] {
  const conditions = [
    eq(messagesTable.author, "user" as const),
    eq(messagesTable.opencodeDeliveryStatus, "sent"),
    inArray(messagesTable.completionWatchStatus, ["watching", "source_failed"]),
  ];
  if (sessionId) conditions.push(eq(messagesTable.sessionId, sessionId));
  return drizzleDb
    .select(messageSelectColumns)
    .from(messagesTable)
    .where(and(...conditions))
    .orderBy(asc(messagesTable.id))
    .all()
    .map((row) => validateDb(DbMessage, row, "activeCompletionWatches"));
}

export function markCompletionWorkSeen(messageId: number): void {
  drizzleDb
    .update(messagesTable)
    .set({ completionWatchWorkSeen: 1 })
    .where(eq(messagesTable.id, messageId))
    .run();
}

export function setCompletionWatchNextCheckAt(messageId: number, nextCheckAt: number): void {
  drizzleDb
    .update(messagesTable)
    .set({ completionWatchNextCheckAt: nextCheckAt })
    .where(eq(messagesTable.id, messageId))
    .run();
}

export function setCompletionTargetNotification(
  watchedMessageId: number,
  notificationMessageId: number,
): void {
  drizzleDb
    .update(messagesTable)
    .set({ completionTargetNotificationMessageId: notificationMessageId })
    .where(eq(messagesTable.id, watchedMessageId))
    .run();
}

export function setCompletionSourceNotification(
  watchedMessageId: number,
  notificationMessageId: number,
): void {
  drizzleDb
    .update(messagesTable)
    .set({ completionSourceNotificationMessageId: notificationMessageId })
    .where(eq(messagesTable.id, watchedMessageId))
    .run();
}

export function setCompletionWatchStatus(messageId: number, status: string, nextCheckAt = 0): void {
  drizzleDb
    .update(messagesTable)
    .set({ completionWatchStatus: status, completionWatchNextCheckAt: nextCheckAt })
    .where(eq(messagesTable.id, messageId))
    .run();
}

export function updateForwardTarget(
  sourceMessageId: number,
  targetMessageId: number,
  forwardStatus: string,
): void {
  drizzleDb
    .update(messagesTable)
    .set({ forwardTargetMessageId: targetMessageId, forwardStatus })
    .where(eq(messagesTable.id, sourceMessageId))
    .run();
}

export function updateForwardStatus(messageId: number, forwardStatus: string): void {
  drizzleDb
    .update(messagesTable)
    .set({ forwardStatus })
    .where(eq(messagesTable.id, messageId))
    .run();
}

export function setAttachedSession(messageId: number, sessionId: string | null): void {
  drizzleDb
    .update(messagesTable)
    .set({ attachedSessionId: sessionId })
    .where(eq(messagesTable.id, messageId))
    .run();
}

export function setMessageStatus(messageId: number, status: string): void {
  drizzleDb.update(messagesTable).set({ status }).where(eq(messagesTable.id, messageId)).run();
}

export function setMessagePinned(messageId: number, pinned: boolean): void {
  drizzleDb
    .update(messagesTable)
    .set({ pinned: pinned ? 1 : 0 })
    .where(eq(messagesTable.id, messageId))
    .run();
}

export function deleteMessage(messageId: number): void {
  drizzleDb.delete(messagesTable).where(eq(messagesTable.id, messageId)).run();
}

export function deleteThread(rootMessageId: number): void {
  drizzleDb
    .delete(messagesTable)
    .where(or(eq(messagesTable.id, rootMessageId), eq(messagesTable.parentId, rootMessageId)))
    .run();
}

export function deserializeMessage(
  message: DbMessage,
  attachments = listAttachmentsForMessage(message.id),
  sessionIndex?: Map<string, MessageSessionReference>,
): Omit<DbMessage, "links" | "sessionRefs"> & {
  links: string[] | null;
  attachments: ReturnType<typeof serializeAttachment>[];
  sessions: MessageSessionReference[];
  extraMarkdownHtml?: string;
} {
  const { sessionRefs: _sessionRefs, ...rest } = message;
  return {
    ...rest,
    links: parseLinks(message.links),
    attachments,
    sessions: resolveMessageSessions(message, sessionIndex),
    ...extraMarkdownHtmlField(message.extraMarkdown),
  };
}

export function listMessages(sessionId = "default"): ReturnType<typeof deserializeMessage>[] {
  const attachments = attachmentsByMessageId(sessionId);
  const sessionIndex = buildSessionReferenceIndex();
  return drizzleDb
    .select(messageSelectColumns)
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, sessionId))
    .orderBy(asc(messagesTable.id))
    .all()
    .map((row) => validateDb(DbMessage, row, "allMessages"))
    .map((message) => deserializeMessage(message, attachments.get(message.id) || [], sessionIndex));
}

export function listSessionsReferencingSession(sessionId: string): string[] {
  const sessionRefNeedle = `%"id":"${sessionId}"%`;
  const mentionNeedle = `%say-to-me(${sessionId})%`;
  return drizzleDb
    .selectDistinct({ sessionId: messagesTable.sessionId })
    .from(messagesTable)
    .where(
      and(
        ne(messagesTable.sessionId, sessionId),
        or(
          like(messagesTable.sessionRefs, sessionRefNeedle),
          like(messagesTable.text, mentionNeedle),
        ),
      ),
    )
    .all()
    .map((row) => row.sessionId);
}

export function prunePlayedHistory(sessionId: string): void {
  const eligibleRoot = and(
    eq(messagesTable.sessionId, sessionId),
    isNull(messagesTable.parentId),
    notInArray(messagesTable.status, playableStatuses),
    eq(messagesTable.pinned, 0),
    sql`NOT EXISTS (
      SELECT 1 FROM messages AS pinned_reply
      WHERE pinned_reply.parent_id = ${messagesTable.id}
        AND pinned_reply.pinned = 1
    )`,
  );
  const row = validateDb(
    DbCount,
    drizzleDb
      .select({ count: sql<number>`COUNT(*)` })
      .from(messagesTable)
      .where(eligibleRoot)
      .get(),
    "playedRootMessageCount",
  );
  const overflow = row.count - maxTotalMessages();
  if (overflow > 0) {
    const oldestPlayedIds = drizzleDb
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eligibleRoot)
      .orderBy(asc(messagesTable.id))
      .limit(overflow)
      .all()
      .map((message) => message.id);

    if (oldestPlayedIds.length === 0) return;

    drizzleDb
      .delete(messagesTable)
      .where(
        or(
          inArray(messagesTable.id, oldestPlayedIds),
          inArray(messagesTable.parentId, oldestPlayedIds),
        ),
      )
      .run();
  }
}
