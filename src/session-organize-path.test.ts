import { describe, expect, it } from "vite-plus/test";

import {
  formatOrganizePath,
  ORGANIZE_ROOT_CRUMB,
  resolveOrganizePathForSession,
} from "./session-organize-path.ts";

describe("session-organize-path", () => {
  const folders = [
    { id: "fold_say", name: "say-to-me", parentId: null },
    { id: "fold_builder", name: "builder", parentId: "fold_say" },
    { id: "fold_tmp", name: "tmp", parentId: "fold_builder" },
  ];

  it("returns folder names from root to the session parent", () => {
    expect(
      resolveOrganizePathForSession("cur_test", folders, [
        { sessionId: "cur_test", folderId: "fold_tmp" },
      ]),
    ).toEqual([
      { id: "fold_say", name: "say-to-me" },
      { id: "fold_builder", name: "builder" },
      { id: "fold_tmp", name: "tmp" },
    ]);
  });

  it("returns Home for unplaced sessions", () => {
    expect(resolveOrganizePathForSession("cur_test", folders, [])).toEqual([ORGANIZE_ROOT_CRUMB]);
  });

  it("returns Home for sessions placed at organize root", () => {
    expect(
      resolveOrganizePathForSession("cur_test", folders, [
        { sessionId: "cur_test", folderId: null },
      ]),
    ).toEqual([ORGANIZE_ROOT_CRUMB]);
  });

  it("formats crumbs as slash-separated names", () => {
    expect(
      formatOrganizePath([
        { id: "fold_say", name: "say-to-me" },
        { id: "fold_builder", name: "builder" },
        { id: "fold_tmp", name: "tmp" },
      ]),
    ).toBe("say-to-me / builder / tmp");
  });
});
