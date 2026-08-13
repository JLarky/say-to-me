import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-quick-search-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { dispatchEffectApiRequest } = await import("./effect-api.ts");
const { drizzleDb } = await import("../db/index.ts");
const { messages, sessions, spaceSessions, spaces } = await import("../db/drizzle-schema.ts");

async function quickSearch(q?: string, currentSpaceId?: string) {
  const params = new URLSearchParams();
  if (q != null) params.set("q", q);
  if (currentSpaceId) params.set("currentSpaceId", currentSpaceId);
  const suffix = params.size ? `?${params}` : "";
  return dispatchEffectApiRequest(new Request(`http://say.local/api/quick-search${suffix}`));
}

describe("GET /api/quick-search", () => {
  beforeAll(() => {
    drizzleDb
      .insert(spaces)
      .values([
        { id: "space-notes", name: "Notes", context: "writing desk", archived: 0 },
        { id: "space-arch", name: "Archived Space", context: "gone", archived: 1 },
        { id: "space-work", name: "Work", context: "daily notes backlog", archived: 0 },
      ])
      .run();
    drizzleDb
      .insert(sessions)
      .values([
        {
          id: "ses_9265d9238061Z2W0cSspYHSYhV",
          alias: "Alpha Bot",
          opencodeProjectName: "Widget Lab",
          cwd: "/tmp/say-to-me-demo",
          state: "general",
        },
        {
          id: "ses_626c9b6a64b3QYHDvshtbYb4Kf",
          alias: "Old Alpha",
          state: "archived",
        },
        {
          id: "ses_639753befdf6wDbqip9t5rYV7Z",
          alias: "Other",
          state: "general",
        },
      ])
      .run();
    drizzleDb
      .insert(spaceSessions)
      .values([
        { sessionId: "ses_9265d9238061Z2W0cSspYHSYhV", spaceId: "space-notes" },
        { sessionId: "ses_639753befdf6wDbqip9t5rYV7Z", spaceId: "space-work" },
      ])
      .run();
    drizzleDb
      .insert(messages)
      .values({
        sessionId: "ses_639753befdf6wDbqip9t5rYV7Z",
        text: "secret message body widget",
        author: "agent",
        status: "done",
      })
      .run();
  });

  afterAll(() => {
    rmSync(testDbDir, { recursive: true, force: true });
  });

  it("matches session id alias durable title and cwd without message bodies", async () => {
    const byId = await quickSearch("ses_9265d9238061Z2W0cSspYHSYhV");
    expect(byId?.status).toBe(200);
    const idBody = (await byId!.json()) as {
      sessions: Array<{ id: string; href: string; matchReason: string }>;
      spaces: unknown[];
    };
    expect(idBody.sessions.some((s) => s.id === "ses_9265d9238061Z2W0cSspYHSYhV")).toBe(true);
    expect(idBody.sessions.find((s) => s.id === "ses_9265d9238061Z2W0cSspYHSYhV")?.href).toBe(
      "/ses/ses_9265d9238061Z2W0cSspYHSYhV",
    );

    const byAlias = await quickSearch("Alpha Bot");
    const aliasBody = (await byAlias!.json()) as { sessions: Array<{ id: string }> };
    expect(aliasBody.sessions.map((s) => s.id)).toContain("ses_9265d9238061Z2W0cSspYHSYhV");

    const byTitle = await quickSearch("Widget");
    const titleBody = (await byTitle!.json()) as { sessions: Array<{ id: string }> };
    expect(titleBody.sessions.map((s) => s.id)).toContain("ses_9265d9238061Z2W0cSspYHSYhV");

    const byCwd = await quickSearch("say-to-me-demo");
    const cwdBody = (await byCwd!.json()) as { sessions: Array<{ id: string }> };
    expect(cwdBody.sessions.map((s) => s.id)).toContain("ses_9265d9238061Z2W0cSspYHSYhV");

    const messageProbe = await quickSearch("secret message body");
    const probe = (await messageProbe!.json()) as {
      sessions: unknown[];
      spaces: unknown[];
    };
    expect(probe.sessions).toEqual([]);
    expect(probe.spaces).toEqual([]);
  });

  it("matches space name/context and never returns archived spaces", async () => {
    const byName = await quickSearch("Notes");
    const nameBody = (await byName!.json()) as {
      spaces: Array<{ id: string; href: string; matchReason: string }>;
    };
    expect(nameBody.spaces.some((s) => s.id === "space-notes")).toBe(true);
    expect(nameBody.spaces.find((s) => s.id === "space-notes")?.href).toBe(
      "/dashboard/space-notes",
    );
    expect(nameBody.spaces.some((s) => s.id === "space-arch")).toBe(false);

    const byContext = await quickSearch("writing desk");
    const ctxBody = (await byContext!.json()) as { spaces: Array<{ id: string }> };
    expect(ctxBody.spaces.map((s) => s.id)).toContain("space-notes");
  });

  it("includes archived sessions when queried with badge and demotion", async () => {
    const response = await quickSearch("Old Alpha");
    const body = (await response!.json()) as {
      sessions: Array<{ id: string; archived: boolean; matchReason: string }>;
    };
    const hit = body.sessions.find((s) => s.id === "ses_626c9b6a64b3QYHDvshtbYb4Kf");
    expect(hit?.archived).toBe(true);
  });

  it("empty query returns non-archived recents only", async () => {
    const response = await quickSearch("");
    const body = (await response!.json()) as {
      sessions: Array<{ id: string; archived: boolean }>;
      spaces: Array<{ id: string }>;
    };
    expect(body.sessions.every((s) => !s.archived)).toBe(true);
    expect(body.sessions.some((s) => s.id === "ses_626c9b6a64b3QYHDvshtbYb4Kf")).toBe(false);
    expect(body.spaces.some((s) => s.id === "space-arch")).toBe(false);
  });

  it("treats SQL wildcards as literals", async () => {
    drizzleDb
      .insert(sessions)
      .values({ id: "ses_5101903f93b7m6H3Z1sEEhiS1Q", alias: "100%_done", state: "general" })
      .run();
    const response = await quickSearch("100%_done");
    const body = (await response!.json()) as { sessions: Array<{ id: string }> };
    expect(body.sessions.map((s) => s.id)).toContain("ses_5101903f93b7m6H3Z1sEEhiS1Q");
  });

  it("does not change /api/search message behavior", async () => {
    const response = await dispatchEffectApiRequest(
      new Request("http://say.local/api/search?q=secret%20message%20body"),
    );
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      messages: Array<{ text: string }>;
      sessions: unknown[];
    };
    expect(body.messages.some((m) => m.text.includes("secret message body"))).toBe(true);
  });

  it("matches Unicode case-folded aliases without SQL LIKE", async () => {
    drizzleDb
      .insert(sessions)
      .values({ id: "ses_f3f5be567dd9bcu1iXPCmfuc1y", alias: "Café Special", state: "general" })
      .run();
    const response = await quickSearch("café special");
    const body = (await response!.json()) as { sessions: Array<{ id: string }> };
    expect(body.sessions.map((s) => s.id)).toContain("ses_f3f5be567dd9bcu1iXPCmfuc1y");
  });

  it("keeps exact alias matches even when many weaker substring candidates exist", async () => {
    const bulk = Array.from({ length: 40 }, (_, i) => ({
      id: `ses_fa913ad399263VdgGS1ZUOR06A_${String(i).padStart(3, "0")}`,
      alias: `needle-noise-${i}`,
      state: "general" as const,
    }));
    drizzleDb.insert(sessions).values(bulk).run();
    drizzleDb
      .insert(sessions)
      .values({
        id: "ses_f86437dc34cavlXlaeJyynhzA5_alias",
        alias: "NeedleExact",
        state: "general",
      })
      .run();
    const response = await quickSearch("NeedleExact");
    const body = (await response!.json()) as {
      sessions: Array<{ id: string; matchReason: string }>;
    };
    expect(body.sessions[0]?.id).toBe("ses_f86437dc34cavlXlaeJyynhzA5_alias");
    expect(body.sessions[0]?.matchReason).toBe("exact-alias");
  });

  it("matches OpenCode in-memory cached titles only", async () => {
    const { opencodeSessionInfoCache } = await import("../opencode/cache.ts");
    drizzleDb
      .insert(sessions)
      .values({
        id: "ses_a8d35fdb63eb2iwu3v91tzIR5I_title",
        alias: null,
        opencodeProjectName: null,
        cwd: "/tmp/unrelated-path",
        state: "general",
      })
      .run();
    opencodeSessionInfoCache.set("ses_a8d35fdb63eb2iwu3v91tzIR5I_title", {
      title: "Zodiac Cache Title Only",
      directory: null,
      agent: null,
      modelProvider: null,
      model: null,
      time: Date.now(),
    });
    const response = await quickSearch("Zodiac Cache");
    const body = (await response!.json()) as { sessions: Array<{ id: string; title: string }> };
    expect(body.sessions.some((s) => s.id === "ses_a8d35fdb63eb2iwu3v91tzIR5I_title")).toBe(true);
    opencodeSessionInfoCache.delete("ses_a8d35fdb63eb2iwu3v91tzIR5I_title");
  });
});
