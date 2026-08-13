import { describe, expect, it } from "vite-plus/test";
import {
  excerptText,
  highlightMatch,
  isIdMatchReason,
  sessionSecondaryLine,
  shortenSessionId,
  spaceSecondaryLine,
} from "./quick-search-display.ts";

describe("quick-search-display", () => {
  it("shortens long session ids", () => {
    expect(shortenSessionId("ses_6677312375b58NM3hX4ApHjGTV")).toBe("ses_6677312375…NM3hX4ApHjGTV");
    expect(shortenSessionId("ses_" + "a".repeat(40)).includes("…")).toBe(true);
  });

  it("builds session and space secondary lines without match reasons", () => {
    expect(
      sessionSecondaryLine({ id: "ses_8a6e1aba4983dIrSSmkVUyda9N", ownerSpaceName: "Notes" }),
    ).toBe("ses_8a6e1aba49…IrSSmkVUyda9N · Notes");
    expect(spaceSecondaryLine({ context: "writing desk notes", id: "space-1" })).toBe(
      "writing desk notes",
    );
    expect(spaceSecondaryLine({ context: "", id: "space-1" })).toBe("Space");
    expect(excerptText("a ".repeat(50)).endsWith("…")).toBe(true);
  });

  it("highlights matched substrings and flags id match reasons", () => {
    expect(highlightMatch("Default", "def")).toEqual([{ match: "Def" }, "ault"]);
    expect(isIdMatchReason("exact-id")).toBe(true);
    expect(isIdMatchReason("id-prefix")).toBe(true);
    expect(isIdMatchReason("exact-name")).toBe(false);
  });
});
