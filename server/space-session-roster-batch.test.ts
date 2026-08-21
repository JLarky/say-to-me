import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-roster-batch-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { drizzleDb, drizzleSqlite } = await import("./db/index.ts");
const { messages, routines, sessions } = await import("./db/drizzle-schema.ts");
const {
  countRosterMessageCandidates,
  loadLatestMessageFactsBatch,
  loadTimerSummariesBatch,
  ROSTER_MESSAGE_CANDIDATES_PER_SESSION,
} = await import("./space-session-roster.ts");

describe("space roster bounded batch loaders", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("selects the latest meaningful message while bounding candidates per session", () => {
    const sessionId = "ses_8b253017072ft08GqnFiUzKi38";
    drizzleDb.insert(sessions).values({ id: sessionId, alias: "Batch" }).run();

    const noise = ROSTER_MESSAGE_CANDIDATES_PER_SESSION + 20;
    for (let i = 0; i < noise; i++) {
      drizzleDb
        .insert(messages)
        .values({
          sessionId,
          text: `noise-${i}`,
          author: "agent",
          status: "done",
          opencodeDeliveryStatus: "sent",
        })
        .run();
    }
    drizzleDb
      .insert(messages)
      .values({
        sessionId,
        text: "ROSTER-LIVE-2026",
        author: "agent",
        status: "done",
        opencodeDeliveryStatus: "sent",
      })
      .run();
    drizzleDb
      .insert(messages)
      .values({
        sessionId,
        text: "<say-to-me-system>Batch is idle now after reply</say-to-me-system>",
        author: "agent",
        status: "done",
        opencodeDeliveryStatus: "ui_only",
      })
      .run();

    const totalMessages = drizzleDb
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all().length;
    expect(totalMessages).toBeGreaterThan(ROSTER_MESSAGE_CANDIDATES_PER_SESSION);

    const candidateCount = countRosterMessageCandidates([sessionId]);
    expect(candidateCount).toBe(ROSTER_MESSAGE_CANDIDATES_PER_SESSION);

    const facts = loadLatestMessageFactsBatch([sessionId]);
    expect(facts.get(sessionId)?.text).toBe("ROSTER-LIVE-2026");
  });

  it("loads timer summaries in one batch across sessions", () => {
    const a = "ses_1dae1cf8bc88L7i0dleNeyXOje";
    const b = "ses_1fa7c016f6f8DZwJzjwPYdii5X";
    drizzleDb.insert(sessions).values({ id: a, alias: "A" }).run();
    drizzleDb.insert(sessions).values({ id: b, alias: "B" }).run();
    const now = Date.parse("2026-07-18T12:00:00Z");
    drizzleDb
      .insert(routines)
      .values({
        ownerSessionId: a,
        title: "Soon A",
        status: "active",
        triggerKind: "schedule",
        trigger: JSON.stringify({
          kind: "schedule",
          dueAt: now + 60_000,
          intervalMs: null,
          nextFireAt: now + 60_000,
        }),
        action: JSON.stringify({
          kind: "deliver_prompt",
          title: "Soon A",
          message: "a",
        }),
        nextFireAt: now + 60_000,
      })
      .run();
    drizzleDb
      .insert(routines)
      .values({
        ownerSessionId: b,
        title: "Soon B",
        status: "paused",
        triggerKind: "schedule",
        trigger: JSON.stringify({
          kind: "schedule",
          dueAt: now + 120_000,
          intervalMs: null,
          nextFireAt: now + 120_000,
        }),
        action: JSON.stringify({
          kind: "deliver_prompt",
          title: "Soon B",
          message: "b",
        }),
        nextFireAt: now + 120_000,
      })
      .run();

    const summaries = loadTimerSummariesBatch([a, b], now);
    expect(summaries.get(a)).toContain("Soon A");
    expect(summaries.get(b)).toContain("Soon B");
    expect(summaries.get(b)).toContain("paused");
  });
});
