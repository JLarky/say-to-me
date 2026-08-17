import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JsonValue } from "@say-to-me/runtime-validation";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { setSessionCwd } from "../sessions.ts";
import { getCursorActivitySnapshot, shutdownCursorActivityHub } from "./activity-hub.ts";
import { cursorSessionFilePath } from "./delivery.ts";

const sessionUuid = "a35fda79-2e0e-4884-9085-0a250ef8f965";
const sessionId = `cur_${sessionUuid}`;
const line = (obj: JsonValue) => JSON.stringify(obj);

let testHome: string;
let testCwd: string;
let previousRoot: string | undefined;

function writeTranscript(contents: string): void {
  const sessionPath = cursorSessionFilePath(testCwd, sessionId);
  mkdirSync(path.dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, contents);
}

beforeEach(() => {
  previousRoot = process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
  testHome = mkdtempSync(path.join(tmpdir(), "say-cursor-activity-home-"));
  testCwd = mkdtempSync(path.join(tmpdir(), "say-cursor-activity-cwd-"));
  process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;
  setSessionCwd(sessionId, testCwd);
});

afterEach(() => {
  shutdownCursorActivityHub();
  if (previousRoot === undefined) delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
  else process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = previousRoot;
  rmSync(testHome, { recursive: true, force: true });
  rmSync(testCwd, { recursive: true, force: true });
});

describe("cursor activity hub", () => {
  it("returns limited snapshots from the Cursor transcript", async () => {
    writeTranscript(
      [
        line({
          role: "assistant",
          message: { content: [{ type: "text", text: "Checking files." }] },
        }),
        line({
          role: "assistant",
          message: { content: [{ type: "tool_use", name: "run_terminal_cmd" }] },
        }),
      ].join("\n"),
    );

    const snapshot = await getCursorActivitySnapshot(sessionId, 1);

    expect(snapshot).toMatchObject({
      busy: false,
      status: "idle",
      items: [{ kind: "tool", tool: "run_terminal_cmd", text: "run_terminal_cmd" }],
    });
  });
});
