import { describe, expect, it } from "vitest";

import { unclaimedT3ImportSessions } from "./t3-api.ts";

describe("unclaimedT3ImportSessions", () => {
  it("excludes T3 sessions already imported into Say To Me", () => {
    const sessions = [
      {
        sessionId: "t3_unclaimed",
        chatId: "unclaimed",
        title: "Unclaimed",
        modifiedAt: null,
        imported: false,
        instanceId: "default",
        projectId: "project",
        branch: null,
        worktreePath: null,
        workspaceRoot: "/repo",
      },
      {
        sessionId: "t3_imported",
        chatId: "imported",
        title: "Imported",
        modifiedAt: null,
        imported: true,
        instanceId: "default",
        projectId: "project",
        branch: null,
        worktreePath: null,
        workspaceRoot: "/repo",
      },
    ];

    expect(unclaimedT3ImportSessions(sessions)).toEqual([sessions[0]]);
  });
});
