import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-roster-nodisk-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const claudeTitle = await import("./claude/title.ts");
const cursorTitle = await import("./cursor/title.ts");
const grokTitle = await import("./grok/title.ts");
const codexTitle = await import("./codex/title.ts");
const sessionEnrich = await import("./session-enrich.ts");
const { opencodeSessionInfoCache } = await import("./opencode/cache.ts");
const { drizzleDb, drizzleSqlite } = await import("./db/index.ts");
const { sessions } = await import("./db/drizzle-schema.ts");
const { buildSpaceRosterSession, buildSpaceRosterSessionsForOwners } =
  await import("./space-session-roster.ts");

describe("space roster enrichment avoids provider disk reads", () => {
  beforeEach(() => {
    opencodeSessionInfoCache.clear();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("never calls SessionTitle disk readers or getCachedProviderTitle while building roster rows", () => {
    const claudeId = "cc_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
    const cursorId = "cur_bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
    const openCodeId = "ses_3ede4289d13cModMZg18qnk2oi";

    drizzleDb
      .insert(sessions)
      .values([
        {
          id: claudeId,
          alias: "Claude Durable",
          cwd: "/tmp/claude",
          state: "general",
        },
        {
          id: cursorId,
          alias: "Cursor Durable",
          cwd: "/tmp/cursor",
          state: "general",
        },
        {
          id: openCodeId,
          alias: null,
          opencodeProjectName: "Durable Project",
          cwd: "/tmp/opencode",
          state: "general",
          opencodeSelectedModel: "gpt-test",
        },
      ])
      .run();

    opencodeSessionInfoCache.set(openCodeId, {
      title: "Cached OpenCode Title",
      directory: "/tmp/opencode",
      agent: "build",
      modelProvider: "openai",
      model: "cached-model",
      time: Date.now(),
    });

    const claudeSpy = vi.spyOn(claudeTitle, "readClaudeTitle");
    const cursorSpy = vi.spyOn(cursorTitle, "readCursorTitle");
    const grokSpy = vi.spyOn(grokTitle, "readGrokTitle");
    const codexSpy = vi.spyOn(codexTitle, "readCodexTitle");
    const enrichSpy = vi.spyOn(sessionEnrich, "getCachedProviderTitle");
    const listEnrichSpy = vi.spyOn(sessionEnrich, "enrichSessionForList");

    const rows = drizzleDb.select().from(sessions).all();
    const now = 1_700_000_000_000;
    const roster = buildSpaceRosterSessionsForOwners(
      [
        { sessionId: claudeId, spaceId: "space-x", importedAt: "2026-07-18 01:00:00" },
        { sessionId: cursorId, spaceId: "space-x", importedAt: "2026-07-18 01:00:00" },
        { sessionId: openCodeId, spaceId: "space-x", importedAt: "2026-07-18 01:00:00" },
      ],
      rows,
      () => undefined,
      now,
    );

    expect(roster.map((item) => item.id).sort()).toEqual([claudeId, cursorId, openCodeId].sort());
    expect(roster.find((item) => item.id === openCodeId)?.title).toBe("Cached OpenCode Title");
    expect(roster.find((item) => item.id === openCodeId)?.model).toBe("cached-model");
    expect(roster.find((item) => item.id === claudeId)?.title).toContain("Claude Durable");

    expect(claudeSpy).not.toHaveBeenCalled();
    expect(cursorSpy).not.toHaveBeenCalled();
    expect(grokSpy).not.toHaveBeenCalled();
    expect(codexSpy).not.toHaveBeenCalled();
    expect(enrichSpy).not.toHaveBeenCalled();
    expect(listEnrichSpy).not.toHaveBeenCalled();

    // Single-row builder path also stays memory/durable-only.
    const single = buildSpaceRosterSession(
      rows.find((row) => row.id === cursorId)!,
      { now },
    );
    expect(single.title).toContain("Cursor Durable");
    expect(single.archived).toBe(false);
    expect(claudeSpy).not.toHaveBeenCalled();
    expect(cursorSpy).not.toHaveBeenCalled();
    expect(enrichSpy).not.toHaveBeenCalled();
  });

  it("marks archived sessions on roster rows", () => {
    const archivedId = "cur_aaaaaaaa-aaaa-bbbb-cccc-dddddddddddd";
    drizzleDb
      .insert(sessions)
      .values({
        id: archivedId,
        alias: null,
        state: "archived",
        cwd: "/tmp/archived",
        opencodeProjectName: "Archived Durable",
      })
      .run();
    const row = drizzleDb
      .select()
      .from(sessions)
      .all()
      .find((session) => session.id === archivedId)!;
    expect(buildSpaceRosterSession(row, { now: 1_700_000_000_000 }).archived).toBe(true);
  });
});
