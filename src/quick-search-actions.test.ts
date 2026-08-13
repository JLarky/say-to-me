import { describe, expect, it } from "vite-plus/test";

import {
  buildQuickSearchActions,
  matchImportFolderPath,
  messageSearchHref,
} from "./quick-search-actions.ts";
import { matchImportableSessionId } from "./session-id-patterns.ts";

describe("quick-search-actions", () => {
  it("matches prefixed session ids used by the sessions import form", () => {
    expect(matchImportableSessionId("ses_1dd864100ffes6uqv2NbJatAKt")).toBe(
      "ses_1dd864100ffes6uqv2NbJatAKt",
    );
    // SES_ is not accepted — OpenCode recognition stays case-sensitive like the server.
    expect(matchImportableSessionId("SES_1dd864100ffes6uqv2NbJatAKt")).toBeNull();
    // Junk ses_ shapes are no longer offered as OpenCode import (Y3).
    expect(matchImportableSessionId("ses_ses")).toBeNull();
    expect(matchImportableSessionId("ses_ab")).toBeNull();
    expect(matchImportableSessionId("ses_test")).toBeNull();
    expect(matchImportableSessionId("  cur_e6ca1259-5b7f-4de3-afd5-a877811435cb ")).toBe(
      "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb",
    );
    expect(matchImportableSessionId("CUR_E6CA1259-5B7F-4DE3-AFD5-A877811435CB")).toBe(
      "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb",
    );
    expect(matchImportableSessionId("cc_5c708e22-807e-4579-807a-b56d8e4341e1")).toBe(
      "cc_5c708e22-807e-4579-807a-b56d8e4341e1",
    );
    expect(matchImportableSessionId("cx_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(
      "cx_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(matchImportableSessionId("gr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(
      "gr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    // Voice ids are local — not imported from an agent backend.
    expect(matchImportableSessionId("vo_shopping-notes")).toBeNull();
    expect(matchImportableSessionId("not-a-session")).toBeNull();
    expect(matchImportableSessionId("")).toBeNull();
  });

  it("matches folder-shaped paths the sessions import flow accepts", () => {
    expect(matchImportFolderPath("/home/you/project")).toBe("/home/you/project");
    expect(matchImportFolderPath("~/work/app")).toBe("~/work/app");
    expect(matchImportFolderPath("work/app")).toBe("work/app");
    expect(matchImportFolderPath("ses_1dd864100ffes6uqv2NbJatAKt")).toBeNull();
    expect(matchImportFolderPath("plain text")).toBeNull();
  });

  it("builds message-search href with the query prefilled", () => {
    expect(messageSearchHref("alpha beta")).toBe("/search?q=alpha+beta");
    expect(messageSearchHref("")).toBe("/search");
  });

  it("offers import when the id is not local, otherwise only message search", () => {
    const id = "ses_1dd864100ffes6uqv2NbJatAKt";
    const withoutLocal = buildQuickSearchActions({ query: id, localSessionIds: [] });
    expect(withoutLocal.map((action) => action.kind)).toEqual([
      "import-session",
      "search-messages",
    ]);
    expect(withoutLocal[0]?.sessionId).toBe(id);

    const withLocal = buildQuickSearchActions({
      query: id,
      localSessionIds: [id],
    });
    expect(withLocal.map((action) => action.kind)).toEqual(["search-messages"]);
  });

  it("keeps OpenCode ses_ bodies case-sensitive so distinct ids still offer import", () => {
    const id = "ses_1dd864100ffes6uqv2NbJatAKt";
    // Base62 suffix case differs; hex timestamp prefix stays lowercase.
    const otherCase = "ses_1dd864100ffes6uqv2nbJatAKt";
    const actions = buildQuickSearchActions({
      query: otherCase,
      localSessionIds: [id],
    });
    const importAction = actions.find((action) => action.kind === "import-session");
    expect(importAction?.sessionId).toBe(otherCase);
    expect(actions.map((action) => action.kind)).toEqual(["import-session", "search-messages"]);
  });

  it("offers create voice-only for openable names and junk ses_ shapes", () => {
    const shopping = buildQuickSearchActions({ query: "shopping-notes", localSessionIds: [] });
    expect(shopping.map((action) => action.kind)).toEqual([
      "create-voice-session",
      "search-messages",
    ]);
    expect(shopping[0]?.sessionId).toBe("vo_shopping-notes");

    const junk = buildQuickSearchActions({ query: "ses_ses", localSessionIds: [] });
    expect(junk.some((action) => action.kind === "import-session")).toBe(false);
    expect(junk.find((action) => action.kind === "create-voice-session")?.sessionId).toBe(
      "vo_ses_ses",
    );
  });

  it("skips create voice-only when the vo_ id already exists locally", () => {
    const actions = buildQuickSearchActions({
      query: "shopping-notes",
      localSessionIds: ["vo_shopping-notes"],
    });
    expect(actions.map((action) => action.kind)).toEqual(["search-messages"]);
  });

  it("treats uppercase existing local external ids as navigate (no import)", () => {
    const localId = "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb";
    const actions = buildQuickSearchActions({
      query: "CUR_E6CA1259-5B7F-4DE3-AFD5-A877811435CB",
      localSessionIds: [localId],
    });
    expect(actions.map((action) => action.kind)).toEqual(["search-messages"]);
    expect(actions.some((action) => action.kind === "import-session")).toBe(false);
  });

  it("normalizes uppercase non-local external ids for the import action", () => {
    const actions = buildQuickSearchActions({
      query: "CUR_E6CA1259-5B7F-4DE3-AFD5-A877811435CB",
      localSessionIds: [],
    });
    const importAction = actions.find((action) => action.kind === "import-session");
    expect(importAction?.sessionId).toBe("cur_e6ca1259-5b7f-4de3-afd5-a877811435cb");
    expect(importAction?.meta).toBe("cur_e6ca1259-5b7f-4de3-afd5-a877811435cb");
  });

  it("offers folder import plus message search for path queries", () => {
    const actions = buildQuickSearchActions({ query: "/tmp/demo" });
    expect(actions.map((action) => action.kind)).toEqual(["import-folder", "search-messages"]);
    expect(actions[0]?.href).toContain("/sessions/");
  });

  it("always offers message search for non-empty free text", () => {
    const actions = buildQuickSearchActions({ query: "refund timeout" });
    expect(actions).toEqual([
      {
        kind: "search-messages",
        id: "search-messages:refund timeout",
        title: "Search messages for “refund timeout”",
        meta: "Open message search",
        href: "/search?q=refund+timeout",
      },
    ]);
  });
});
