import { describe, expect, it } from "vite-plus/test";

import { backendOf, buildNodes, pinAttentionState, titleOf } from "./organize-tree.ts";

describe("organize-tree", () => {
  it("maps session id prefixes to backends", () => {
    expect(backendOf("ses_82c41693cb14xpTRmGfTDe4Qs6")).toBe("opencode");
    expect(backendOf("cc_1")).toBe("claude");
    expect(backendOf("cur_1")).toBe("cursor");
    expect(backendOf("cx_1")).toBe("codex");
    expect(backendOf("gr_1")).toBe("grok");
    expect(backendOf("vo_notes")).toBe("voice");
    expect(backendOf("other")).toBe("local");
  });

  it("normalizes pin attention state", () => {
    expect(pinAttentionState("important")).toBe("important");
    expect(pinAttentionState("jarvis")).toBe("jarvis");
    expect(pinAttentionState("archived")).toBe("general");
    expect(pinAttentionState(null)).toBe("general");
  });

  it("prefers alias for session titles", () => {
    expect(
      titleOf({ id: "ses_82c41693cb14xpTRmGfTDe4Qs6", alias: "Alfred", opencodeTitle: "raw" }),
    ).toBe("Alfred");
  });

  it("hides archived sessions unless keepArchivedId matches", () => {
    const folders = [{ id: "fold_a", name: "A", parentId: null, sortOrder: 0 }];
    const sessions = [
      { id: "ses_4ebc156019daRRZSPSb2UKOM4j", alias: "Live", state: "general" },
      { id: "ses_aabff9bf45c7y5WJCSZ1Ani7cP", alias: "Arch", state: "archived" },
    ];
    const placements = [
      { sessionId: "ses_4ebc156019daRRZSPSb2UKOM4j", folderId: "fold_a", sortOrder: 0 },
      { sessionId: "ses_aabff9bf45c7y5WJCSZ1Ani7cP", folderId: "fold_a", sortOrder: 1 },
    ];

    expect(buildNodes(folders, placements, sessions, null).map((n) => n.id)).toEqual([
      "fold_a",
      "ses_4ebc156019daRRZSPSb2UKOM4j",
    ]);
    expect(
      buildNodes(folders, placements, sessions, "ses_aabff9bf45c7y5WJCSZ1Ani7cP").map((n) => n.id),
    ).toEqual(["fold_a", "ses_4ebc156019daRRZSPSb2UKOM4j", "ses_aabff9bf45c7y5WJCSZ1Ani7cP"]);
  });

  it("orphans nodes whose parent folder disappeared to the root", () => {
    const nodes = buildNodes(
      [],
      [{ sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6", folderId: "fold_missing", sortOrder: 0 }],
      [{ id: "ses_82c41693cb14xpTRmGfTDe4Qs6", alias: "One", state: "general" }],
      null,
    );
    expect(nodes).toEqual([
      {
        id: "ses_82c41693cb14xpTRmGfTDe4Qs6",
        kind: "session",
        name: "One",
        parentId: null,
        backend: "opencode",
        alias: "One",
        state: "general",
      },
    ]);
  });
});
