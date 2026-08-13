import { homedir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { cursorProjectDirName, cursorSessionFilePath, resolveCursorResumeId } from "./delivery.ts";

describe("cursor project dir mapping", () => {
  let previousRoot: string | undefined;

  beforeEach(() => {
    previousRoot = process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
    delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
  });

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
    else process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = previousRoot;
  });

  it("strips a leading slash then escapes slashes to dashes", () => {
    expect(cursorProjectDirName("/tmp")).toBe("tmp");
    expect(cursorProjectDirName("/Users/me/vm/say-to-me")).toBe("Users-me-vm-say-to-me");
    expect(cursorProjectDirName("/home/jlarky.guest/work/project")).toBe(
      "home-jlarky-guest-work-project",
    );
    expect(cursorProjectDirName("/home/jlarky.guest/.say-to-me/workspace")).toBe(
      "home-jlarky-guest-say-to-me-workspace",
    );
  });

  it("builds the transcript path under ~/.cursor/projects", () => {
    expect(cursorSessionFilePath("/tmp", "cur_abc-123")).toBe(
      path.join(
        homedir(),
        ".cursor",
        "projects",
        "tmp",
        "agent-transcripts",
        "abc-123",
        "abc-123.jsonl",
      ),
    );
  });
});

describe("resolveCursorResumeId", () => {
  it("returns the bare chat uuid for agent --resume", () => {
    expect(resolveCursorResumeId("/tmp", "cur_00000000-0000-0000-0000-000000000000")).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });
});
