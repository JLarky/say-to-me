import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { claudeCwdFromSessionPath } from "./resolve.ts";

describe("claudeCwdFromSessionPath", () => {
  it("reads cwd from early jsonl records", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "claude-resolve-"));
    const sessionPath = path.join(dir, "session.jsonl");
    writeFileSync(
      sessionPath,
      [
        '{"type":"mode","mode":"normal","sessionId":"5146e06f-df15-428b-8847-e147652444a0"}',
        '{"type":"user","cwd":"/home/jlarky.guest/work/demo-project","sessionId":"5146e06f-df15-428b-8847-e147652444a0"}',
      ].join("\n"),
    );

    expect(claudeCwdFromSessionPath(sessionPath)).toBe("/home/jlarky.guest/work/demo-project");
  });
});
