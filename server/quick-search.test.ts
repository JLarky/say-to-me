import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-quick-search-unit-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const claudeTitle = await import("./claude/title.ts");
const cursorTitle = await import("./cursor/title.ts");
const grokTitle = await import("./grok/title.ts");
const codexTitle = await import("./codex/title.ts");
const sessionEnrich = await import("./session-enrich.ts");
const { opencodeSessionInfoCache } = await import("./opencode/cache.ts");
const { drizzleDb } = await import("./db/index.ts");
const { sessions } = await import("./db/drizzle-schema.ts");
const { peekInMemoryProviderTitle, runQuickSearch } = await import("./quick-search.ts");

describe("quick-search cache-only titles", () => {
  beforeAll(() => {
    drizzleDb
      .insert(sessions)
      .values([
        {
          id: "ses_70e7d9d35319puLR7zhH5bya6K_only",
          alias: null,
          opencodeProjectName: null,
          cwd: "/tmp/other",
          state: "general",
        },
        {
          id: "cc_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          alias: "Claude Row",
          state: "general",
        },
        {
          id: "cur_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          alias: "Cursor Row",
          state: "general",
        },
        {
          id: "gr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          alias: "Grok Row",
          state: "general",
        },
        {
          id: "cx_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          alias: "Codex Row",
          state: "general",
        },
      ])
      .run();
  });

  beforeEach(() => {
    opencodeSessionInfoCache.clear();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    rmSync(testDbDir, { recursive: true, force: true });
  });

  it("never calls provider title disk readers or getCachedProviderTitle", () => {
    const claudeSpy = vi.spyOn(claudeTitle, "readClaudeTitle");
    const cursorSpy = vi.spyOn(cursorTitle, "readCursorTitle");
    const grokSpy = vi.spyOn(grokTitle, "readGrokTitle");
    const codexSpy = vi.spyOn(codexTitle, "readCodexTitle");
    const enrichSpy = vi.spyOn(sessionEnrich, "getCachedProviderTitle");

    runQuickSearch("Claude");
    runQuickSearch("Cursor");
    runQuickSearch("cache-unique-title");
    runQuickSearch("");

    expect(claudeSpy).not.toHaveBeenCalled();
    expect(cursorSpy).not.toHaveBeenCalled();
    expect(grokSpy).not.toHaveBeenCalled();
    expect(codexSpy).not.toHaveBeenCalled();
    expect(enrichSpy).not.toHaveBeenCalled();
  });

  it("matches OpenCode titles already in the in-memory Map with no disk I/O", () => {
    opencodeSessionInfoCache.set("ses_70e7d9d35319puLR7zhH5bya6K_only", {
      title: "Unique Cached Nebula Title",
      directory: null,
      agent: null,
      modelProvider: null,
      model: null,
      time: Date.now(),
    });
    expect(peekInMemoryProviderTitle("ses_70e7d9d35319puLR7zhH5bya6K_only")).toBe(
      "Unique Cached Nebula Title",
    );

    const claudeSpy = vi.spyOn(claudeTitle, "readClaudeTitle");
    const enrichSpy = vi.spyOn(sessionEnrich, "getCachedProviderTitle");

    const result = runQuickSearch("Nebula");
    expect(result.sessions.some((s) => s.id === "ses_70e7d9d35319puLR7zhH5bya6K_only")).toBe(true);
    expect(
      result.sessions.find((s) => s.id === "ses_70e7d9d35319puLR7zhH5bya6K_only")?.title,
    ).toContain("Nebula");
    expect(claudeSpy).not.toHaveBeenCalled();
    expect(enrichSpy).not.toHaveBeenCalled();
  });

  it("OpenCode-only: external CLI sessions get no provider-title peek and keep durable fields", () => {
    const claudeId = "cc_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const cursorId = "cur_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    // Even if a disk title would exist, peek never consults CLI title services.
    expect(peekInMemoryProviderTitle(claudeId)).toBeNull();
    expect(peekInMemoryProviderTitle(cursorId)).toBeNull();

    const claudeSpy = vi.spyOn(claudeTitle, "readClaudeTitle");
    const cursorSpy = vi.spyOn(cursorTitle, "readCursorTitle");

    const byDurable = runQuickSearch("Claude Row");
    expect(byDurable.sessions.some((s) => s.id === claudeId)).toBe(true);
    expect(claudeSpy).not.toHaveBeenCalled();
    expect(cursorSpy).not.toHaveBeenCalled();

    // A query that would only match a CLI disk title must not invent a hit.
    const diskOnly = runQuickSearch("Would Be Disk Title Only");
    expect(diskOnly.sessions).toEqual([]);
  });

  it("prefers cached OpenCode title over opencodeProjectName in displayed hit title", () => {
    drizzleDb
      .insert(sessions)
      .values({
        id: "ses_229521fb19fan25VSQCDibsm3N_and_cache",
        alias: null,
        opencodeProjectName: "Unrelated Project Label",
        cwd: "/tmp/other",
        state: "general",
      })
      .run();
    opencodeSessionInfoCache.set("ses_229521fb19fan25VSQCDibsm3N_and_cache", {
      title: "Visible Cached Session Title",
      directory: null,
      agent: null,
      modelProvider: null,
      model: null,
      time: Date.now(),
    });
    const result = runQuickSearch("Visible Cached");
    const hit = result.sessions.find((s) => s.id === "ses_229521fb19fan25VSQCDibsm3N_and_cache");
    expect(hit?.title).toBe("Visible Cached Session Title");
  });
});
