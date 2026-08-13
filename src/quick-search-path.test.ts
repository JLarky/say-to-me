import { describe, expect, it } from "vite-plus/test";
import { isQuickSearchPath } from "./quick-search-path.ts";

describe("isQuickSearchPath", () => {
  it("matches scoped routes with optional trailing slashes", () => {
    expect(isQuickSearchPath("/search")).toBe(true);
    expect(isQuickSearchPath("/search/")).toBe(true);
    expect(isQuickSearchPath("/dashboard")).toBe(true);
    expect(isQuickSearchPath("/dashboard/space-1")).toBe(true);
    expect(isQuickSearchPath("/dashboard/space-1/")).toBe(true);
  });

  it("rejects settings and legacy pages", () => {
    expect(isQuickSearchPath("/settings")).toBe(false);
    expect(isQuickSearchPath("/ses/x")).toBe(false);
    expect(isQuickSearchPath("/organize")).toBe(false);
    expect(isQuickSearchPath("/dashboard/a/b")).toBe(false);
  });
});
