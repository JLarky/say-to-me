import { describe, expect, it } from "vite-plus/test";
import {
  escapeLikeLiteral,
  isQuickSearchPath,
  likeContainsPattern,
  normalizeQuickSearchQuery,
  rankQuickSearchSessions,
  rankQuickSearchSpaces,
  type QuickSearchSessionCandidate,
  type QuickSearchSpaceCandidate,
} from "./quick-search-rank.ts";

function session(
  partial: Partial<QuickSearchSessionCandidate> & { id: string },
): QuickSearchSessionCandidate {
  return {
    alias: null,
    durableTitle: null,
    cachedTitle: null,
    cwd: null,
    state: "general",
    updatedAt: "2026-01-01 00:00:00",
    ownerSpaceId: null,
    ownerSpaceName: null,
    ...partial,
  };
}

function space(
  partial: Partial<QuickSearchSpaceCandidate> & { id: string; name: string },
): QuickSearchSpaceCandidate {
  return {
    context: "",
    updatedAt: "2026-01-01 00:00:00",
    ...partial,
  };
}

describe("normalizeQuickSearchQuery", () => {
  it("NFKC, collapses whitespace, and truncates to 120", () => {
    expect(normalizeQuickSearchQuery("  Foo\t\nBar  ")).toBe("Foo Bar");
    expect(normalizeQuickSearchQuery("ａ")).toBe("ａ".normalize("NFKC"));
    expect(normalizeQuickSearchQuery("x".repeat(200)).length).toBe(120);
  });
});

describe("escapeLikeLiteral", () => {
  it("escapes backslash percent and underscore", () => {
    expect(escapeLikeLiteral("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(likeContainsPattern("100%")).toBe("%100\\%%");
  });
});

describe("isQuickSearchPath", () => {
  it("allows search and dashboard routes including trailing slashes", () => {
    expect(isQuickSearchPath("/search")).toBe(true);
    expect(isQuickSearchPath("/search/")).toBe(true);
    expect(isQuickSearchPath("/dashboard")).toBe(true);
    expect(isQuickSearchPath("/dashboard/")).toBe(true);
    expect(isQuickSearchPath("/dashboard/space-1")).toBe(true);
    expect(isQuickSearchPath("/dashboard/space-1/")).toBe(true);
  });

  it("rejects settings and nested/legacy paths", () => {
    expect(isQuickSearchPath("/settings")).toBe(false);
    expect(isQuickSearchPath("/ses/abc")).toBe(false);
    expect(isQuickSearchPath("/dashboard/a/b")).toBe(false);
    expect(isQuickSearchPath("/")).toBe(false);
  });
});

describe("rankQuickSearchSessions", () => {
  it("ranks exact id above substring and demotes archived on equal textual tier", () => {
    const hits = rankQuickSearchSessions("ses_9265d9238061Z2W0cSspYHSYhV", [
      session({ id: "ses_639753befdf6wDbqip9t5rYV7Z_alpha", updatedAt: "2026-02-01 00:00:00" }),
      session({
        id: "ses_9265d9238061Z2W0cSspYHSYhV",
        state: "archived",
        updatedAt: "2026-03-01 00:00:00",
      }),
      session({
        id: "ses_9265d9238061Z2W0cSspYHSYhV_live",
        alias: "ses_9265d9238061Z2W0cSspYHSYhV",
        updatedAt: "2026-01-01 00:00:00",
      }),
    ]);
    expect(hits[0].id).toBe("ses_9265d9238061Z2W0cSspYHSYhV");
    expect(hits[0].archived).toBe(true);
    expect(hits[0].matchReason).toBe("exact-id");
  });

  it("boosts current-space owner only inside equal textual rank", () => {
    const hits = rankQuickSearchSessions(
      "demo",
      [
        session({
          id: "ses_6f7ff81a35dfGuQ6ZVL7cSlhhM",
          alias: "demo",
          ownerSpaceId: "space-other",
          updatedAt: "2026-05-01 00:00:00",
        }),
        session({
          id: "ses_72a3bd0b1e24kkoCn9yX0fQU0i",
          alias: "demo",
          ownerSpaceId: "space-current",
          updatedAt: "2026-01-01 00:00:00",
        }),
      ],
      "space-current",
    );
    expect(hits.map((h) => h.id)).toEqual([
      "ses_72a3bd0b1e24kkoCn9yX0fQU0i",
      "ses_6f7ff81a35dfGuQ6ZVL7cSlhhM",
    ]);
  });

  it("empty query returns non-archived recents only", () => {
    const hits = rankQuickSearchSessions("", [
      session({ id: "ses_b32a81376ae3lXNMTRLCzBMmRT", updatedAt: "2026-01-01 00:00:00" }),
      session({ id: "ses_5b8231acbc72AhkUb5Whz0E0DM", updatedAt: "2026-06-01 00:00:00" }),
      session({
        id: "ses_aabff9bf45c7y5WJCSZ1Ani7cP",
        state: "archived",
        updatedAt: "2026-07-01 00:00:00",
      }),
    ]);
    expect(hits.map((h) => h.id)).toEqual([
      "ses_5b8231acbc72AhkUb5Whz0E0DM",
      "ses_b32a81376ae3lXNMTRLCzBMmRT",
    ]);
    expect(hits.every((h) => h.matchReason === "recent")).toBe(true);
  });

  it("matches durable title and cwd basename", () => {
    const byTitle = rankQuickSearchSessions("widget", [
      session({ id: "ses_82c41693cb14xpTRmGfTDe4Qs6", durableTitle: "Widget Lab" }),
    ]);
    expect(byTitle[0]?.matchReason).toMatch(/title/);
    const byCwd = rankQuickSearchSessions("oobar", [
      session({
        id: "ses_123a3ffcc10a7c4yQdCkaVveDR",
        alias: "Named Session",
        cwd: "/home/user/foobarbaz",
      }),
    ]);
    expect(byCwd[0]?.matchReason).toBe("substring-cwd");
  });

  it("uses server href semantics", () => {
    const hits = rankQuickSearchSessions("default", [session({ id: "default", alias: "default" })]);
    expect(hits[0]?.href).toBe("/default");
  });

  it("displays cached provider title over projectName when both are set", () => {
    const hits = rankQuickSearchSessions("Nebula", [
      session({
        id: "ses_34559aa356555iitps694EtfE3",
        durableTitle: "Widget Lab",
        cachedTitle: "Unique Cached Nebula Title",
      }),
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("ses_34559aa356555iitps694EtfE3");
    expect(hits[0]?.title).toBe("Unique Cached Nebula Title");
  });

  it("still prefers alias over cached title and projectName", () => {
    const hits = rankQuickSearchSessions("My Alias", [
      session({
        id: "ses_9288ef8f414d5pZKr5IUvABEJy",
        alias: "My Alias",
        durableTitle: "Widget Lab",
        cachedTitle: "Unique Cached Nebula Title",
      }),
    ]);
    expect(hits[0]?.title).toBe("My Alias");
  });
});

describe("rankQuickSearchSpaces", () => {
  it("matches name before context and excludes nothing already filtered", () => {
    const hits = rankQuickSearchSpaces("notes", [
      space({ id: "s1", name: "Work", context: "daily notes", updatedAt: "2026-01-01 00:00:00" }),
      space({ id: "s2", name: "Notes", context: "", updatedAt: "2026-01-02 00:00:00" }),
    ]);
    expect(hits[0].id).toBe("s2");
    expect(hits[0].matchReason).toBe("exact-name");
    expect(hits[1].id).toBe("s1");
    expect(["substring-context", "token-prefix"]).toContain(hits[1].matchReason);
  });

  it("empty query is recents by updatedAt", () => {
    const hits = rankQuickSearchSpaces("", [
      space({ id: "s1", name: "A", updatedAt: "2026-01-01 00:00:00" }),
      space({ id: "s2", name: "B", updatedAt: "2026-02-01 00:00:00" }),
    ]);
    expect(hits.map((h) => h.id)).toEqual(["s2", "s1"]);
    expect(hits[0].href).toBe("/dashboard/s2");
  });
});
