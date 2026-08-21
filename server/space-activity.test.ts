import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-space-activity-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { drizzleDb, drizzleSqlite } = await import("./db/index.ts");
const { messages, routines, sessions, spaceSessions, spaces } =
  await import("./db/drizzle-schema.ts");
const { buildSpaceActivity, parseCreatedAtMs } = await import("./space-activity.ts");
const { recordNotification } = await import("./notification-history.ts");

describe("space activity feed", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("builds newest-first events from persisted messages, notifications, timers, and attachments", () => {
    const spaceId = "space-activity-feed";
    const sessionId = "ses_d2b468a91b23wZihyO7lZKYRfJ";

    drizzleDb
      .insert(spaces)
      .values({
        id: spaceId,
        name: "Activity lab",
        parentId: null,
        archived: 0,
        context: "test",
      })
      .run();
    drizzleDb
      .insert(sessions)
      .values({
        id: sessionId,
        alias: "Activity session",
        cwd: "/tmp/activity",
      })
      .run();
    drizzleDb
      .insert(spaceSessions)
      .values({
        sessionId,
        spaceId,
        importedAt: "2026-07-17 10:00:00",
      })
      .run();
    drizzleDb
      .insert(messages)
      .values({
        sessionId,
        text: "ROSTER-LIVE-2026",
        author: "agent",
        status: "done",
        createdAt: "2026-07-18 01:00:00",
      })
      .run();
    drizzleDb
      .insert(messages)
      .values({
        sessionId,
        text: "<say-to-me-system>Activity session is idle now</say-to-me-system>",
        author: "agent",
        status: "done",
        opencodeDeliveryStatus: "ui_only",
        createdAt: "2026-07-18 01:05:00",
      })
      .run();
    drizzleDb
      .insert(messages)
      .values({
        sessionId,
        text: "Will fail delivery",
        author: "user",
        status: "done",
        opencodeDeliveryStatus: "failed",
        opencodeDeliveryError: "provider rejected",
        createdAt: "2026-07-18 01:10:00",
      })
      .run();
    recordNotification({
      sessionId,
      title: "say-to-me",
      body: "Fixture notification for activity feed",
      url: `/ses/${sessionId}`,
    });
    const routineDueAt = Date.parse("2026-07-18T12:00:00Z");
    drizzleDb
      .insert(routines)
      .values({
        ownerSessionId: sessionId,
        title: "Check roster",
        status: "active",
        triggerKind: "schedule",
        trigger: JSON.stringify({
          kind: "schedule",
          dueAt: routineDueAt,
          intervalMs: null,
          nextFireAt: routineDueAt,
        }),
        action: JSON.stringify({
          kind: "deliver_prompt",
          title: "Check roster",
          message: "Revisit the roster UI",
        }),
        nextFireAt: routineDueAt,
        lastFiredAt: Date.parse("2026-07-17T12:00:00Z"),
        createdAt: "2026-07-16 12:00:00",
        updatedAt: "2026-07-17 12:00:00",
      })
      .run();

    const payload = buildSpaceActivity(spaceId, {
      now: Date.parse("2026-07-18T06:00:00Z"),
    });
    expect(payload).not.toBeNull();
    expect(payload?.spaceName).toBe("Activity lab");
    expect(payload?.retention.scopeNote).toContain("currently attached");
    expect(payload?.retention.maxRangeHours).toBe(720);
    expect(payload?.retention.appliedRangeHours).toBe(168);
    expect(payload?.timerFreshnessNote).toContain("routines");

    const types = new Set(payload?.events.map((event) => event.type));
    expect(types.has("message")).toBe(true);
    expect(types.has("delivery")).toBe(true);
    expect(types.has("notification")).toBe(true);
    expect(types.has("timer")).toBe(true);
    expect(types.has("attachment")).toBe(true);

    expect(payload?.events.some((event) => event.detail.includes("ROSTER-LIVE-2026"))).toBe(true);
    expect(
      payload?.events.some(
        (event) => event.detail.includes("is idle now") && event.type === "message",
      ),
    ).toBe(false);
    expect(payload?.events.some((event) => event.detail.includes("provider rejected"))).toBe(true);
    expect(
      payload?.events.some((event) =>
        event.detail.includes("Fixture notification for activity feed"),
      ),
    ).toBe(true);

    const times = payload?.events.map((event) => event.createdAt) ?? [];
    const epochs = times.map((value) => parseCreatedAtMs(value));
    const sortedEpochs = [...epochs].sort((a, b) => b - a);
    expect(epochs).toEqual(sortedEpochs);
  });

  it("orders mixed SQL and ISO timestamps by parsed epoch, not localeCompare", () => {
    const spaceId = "space-activity-sort-mix";
    const sessionId = "ses_490e1658d676C8EFNYItPdP5O1";
    drizzleDb.insert(spaces).values({ id: spaceId, name: "Sort mix" }).run();
    drizzleDb.insert(sessions).values({ id: sessionId, alias: "Sort mix" }).run();
    drizzleDb
      .insert(spaceSessions)
      .values({
        sessionId,
        spaceId,
        // ISO-like attachment time that would sort *after* SQL strings under localeCompare
        // if compared as text ("2026-07-18T…" > "2026-07-18 12…"), but is actually earlier.
        importedAt: "2026-07-18T09:00:00.000Z",
      })
      .run();
    drizzleDb
      .insert(messages)
      .values({
        sessionId,
        text: "Later SQL timestamp message",
        author: "agent",
        status: "done",
        createdAt: "2026-07-18 12:00:00",
      })
      .run();

    const payload = buildSpaceActivity(spaceId, {
      rangeHours: 720,
      now: Date.parse("2026-07-18T18:00:00.000Z"),
    });
    expect(payload).not.toBeNull();
    const events = payload!.events;
    expect(events[0]?.detail).toContain("Later SQL timestamp message");
    expect(events.some((event) => event.type === "attachment")).toBe(true);

    // localeCompare would put the ISO attachment before the SQL message (wrong).
    const sqlTs = "2026-07-18 12:00:00";
    const isoTs = "2026-07-18T09:00:00.000Z";
    expect(isoTs.localeCompare(sqlTs)).toBeGreaterThan(0);
    expect(parseCreatedAtMs(isoTs)).toBeLessThan(parseCreatedAtMs(sqlTs));

    const epochs = events.map((event) => parseCreatedAtMs(event.createdAt));
    expect(epochs).toEqual([...epochs].sort((a, b) => b - a));
  });

  it("returns null for missing spaces", () => {
    expect(buildSpaceActivity("missing-space")).toBeNull();
  });
});
