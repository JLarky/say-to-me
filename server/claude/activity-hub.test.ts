import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JsonValue } from "@say-to-me/runtime-validation";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { setSessionCwd } from "../sessions.ts";
import { getClaudeActivitySnapshot, shutdownClaudeActivityHub } from "./activity-hub.ts";
import { claudeSessionFilePath } from "./delivery.ts";

const sessionUuid = "5c708e22-807e-4579-807a-b56d8e4341e1";
const sessionId = `cc_${sessionUuid}`;
const line = (obj: JsonValue) => JSON.stringify(obj);

let testHome: string;
let testCwd: string;
let previousRoot: string | undefined;

function writeTranscript(contents: string): void {
  const sessionPath = claudeSessionFilePath(testCwd, sessionId);
  mkdirSync(path.dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, contents);
}

beforeEach(() => {
  previousRoot = process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
  testHome = mkdtempSync(path.join(tmpdir(), "say-claude-activity-home-"));
  testCwd = mkdtempSync(path.join(tmpdir(), "say-claude-activity-cwd-"));
  process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;
  setSessionCwd(sessionId, testCwd);
});

afterEach(() => {
  shutdownClaudeActivityHub();
  if (previousRoot === undefined) delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
  else process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = previousRoot;
  rmSync(testHome, { recursive: true, force: true });
  rmSync(testCwd, { recursive: true, force: true });
});

describe("claude activity hub", () => {
  it("returns limited snapshots from the Claude transcript", async () => {
    writeTranscript(
      [
        line({
          type: "assistant",
          timestamp: "2026-07-03T00:00:00.000Z",
          message: { content: [{ type: "text", text: "Checking files." }] },
        }),
        line({
          type: "assistant",
          timestamp: "2026-07-03T00:00:01.000Z",
          message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "x.ts" } }] },
        }),
      ].join("\n"),
    );

    const snapshot = await getClaudeActivitySnapshot(sessionId, 1);

    expect(snapshot).toMatchObject({
      busy: false,
      status: "idle",
      lastTimestamp: Date.parse("2026-07-03T00:00:01.000Z"),
      items: [{ kind: "tool", tool: "Write", text: "Write x.ts" }],
    });
  });

  it("finds the transcript when cwd slug does not match Claude project dir name", async () => {
    const mismatchedCwd = "/home/jlarky.guest/work/demo-project";
    const slug = "-home-jlarky-guest-work-demo-project";
    setSessionCwd(sessionId, mismatchedCwd);
    const sessionPath = path.join(testHome, ".claude", "projects", slug, `${sessionUuid}.jsonl`);
    mkdirSync(path.dirname(sessionPath), { recursive: true });
    writeFileSync(
      sessionPath,
      line({
        type: "assistant",
        timestamp: "2026-07-03T00:00:00.000Z",
        message: { content: [{ type: "text", text: "Hello from demo-project." }] },
      }),
    );

    const snapshot = await getClaudeActivitySnapshot(sessionId, 5);

    expect(snapshot.items).toMatchObject([
      {
        kind: "message",
        text: "Hello from demo-project.",
        timestamp: Date.parse("2026-07-03T00:00:00.000Z"),
        html: "<p>Hello from demo-project.</p>\n",
      },
    ]);
  });
});
