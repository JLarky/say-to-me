import type Database from "better-sqlite3";
import { type as arktype } from "arktype";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { maxQueuedMessages } from "./config.ts";
import { messages } from "./db/drizzle-schema.ts";
import { DbCount, validateDb } from "./db/schemas.ts";

const ClaimedMessageId = arktype({ id: "number" });

type QueueCapClaimDeps = {
  throwOnClaim?: () => void;
};

let queueCapClaimDeps: QueueCapClaimDeps = {};

export function setQueueCapClaimDepsForTest(deps: QueueCapClaimDeps): void {
  queueCapClaimDeps = deps;
}

export function resetQueueCapClaimDepsForTest(): void {
  queueCapClaimDeps = {};
}

export type QueueCapClaimInput = {
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
  /** Override cap (tests); defaults to SAY_TO_ME_MAX_QUEUED_MESSAGES. */
  cap?: number;
};

export type QueueCapClaimResult =
  | { ok: true; id: number; existing: boolean }
  | { ok: false; error: string };

/**
 * Count + optional eviction skip + insert in one BEGIN IMMEDIATE transaction.
 * Idempotency (client_message_id) is checked first inside the same transaction so
 * concurrent retries cannot double-evict and insert duplicates.
 *
 * Accepts any better-sqlite3 connection so concurrent tests can open a second handle
 * without importing the app singleton (which would re-run migrations). Queries use
 * Drizzle builders; only BEGIN IMMEDIATE stays on the driver.
 */
export function claimQueuedAgentSlot(
  sqlite: Database.Database,
  input: QueueCapClaimInput,
): QueueCapClaimResult {
  queueCapClaimDeps.throwOnClaim?.();
  const cap = input.cap ?? maxQueuedMessages();
  const db = drizzle(sqlite);
  return sqlite
    .transaction(() => {
      if (input.clientMessageId) {
        const existing = db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.sessionId, input.sessionId),
              eq(messages.author, "agent"),
              eq(messages.clientMessageId, input.clientMessageId),
            ),
          )
          .orderBy(asc(messages.id))
          .limit(1)
          .get();
        if (existing) {
          return {
            ok: true as const,
            id: validateDb(ClaimedMessageId, existing, "existingQueuedAgentClaim").id,
            existing: true,
          };
        }
      }

      const queued = validateDb(
        DbCount,
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(messages)
          .where(
            and(
              eq(messages.sessionId, input.sessionId),
              eq(messages.author, "agent"),
              eq(messages.status, "queued"),
            ),
          )
          .get(),
        "queuedMessageCountForSessionClaim",
      ).count;

      if (queued >= cap) {
        if (input.overflow !== "force") {
          return {
            ok: false as const,
            error: `Session queue is full (${cap} queued messages). Pass "overflow":"force" to replace the oldest non-pinned queued message.`,
          };
        }
        const evictable = db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.sessionId, input.sessionId),
              eq(messages.author, "agent"),
              eq(messages.status, "queued"),
              isNull(messages.parentId),
              eq(messages.pinned, 0),
              sql`NOT EXISTS (
                SELECT 1 FROM messages AS pinned_reply
                WHERE pinned_reply.parent_id = ${messages.id}
                  AND pinned_reply.pinned = 1
              )`,
            ),
          )
          .orderBy(asc(messages.id))
          .limit(1)
          .get();
        if (!evictable) {
          return {
            ok: false as const,
            error: `Session queue is full (${cap} queued messages). All queued messages are pinned, so nothing can be replaced.`,
          };
        }
        db.update(messages).set({ status: "skipped" }).where(eq(messages.id, evictable.id)).run();
      }

      const inserted = validateDb(
        ClaimedMessageId,
        db
          .insert(messages)
          .values({
            sessionId: input.sessionId,
            text: input.text,
            extraMarkdown: input.extraMarkdown,
            pushNotificationText: input.pushNotificationText ?? null,
            author: "agent",
            status: "queued",
            links: input.links,
            sessionRefs: input.sessionRefs,
            clientMessageId: input.clientMessageId,
            completionWatchStatus: input.completionWatchStatus ?? null,
            completionSourceSessionId: input.completionSourceSessionId ?? null,
            completionSourceMessageId: input.completionSourceMessageId ?? null,
            paseoAuthor: input.paseoAuthor ?? null,
            paseoAuthorName: input.paseoAuthorName ?? null,
          })
          .returning({ id: messages.id })
          .get(),
        "insertQueuedAgentClaim",
      );
      return { ok: true as const, id: inserted.id, existing: false };
    })
    .immediate();
}
