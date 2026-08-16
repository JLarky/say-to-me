import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { clearCodexSessionJsonlPathCache } from "./resolve.ts";
import { getCodexActivitySnapshot, shutdownCodexActivityHub } from "./activity-hub.ts";

const sessionUuid = "e6ca1259-5b7f-4de3-afd5-a877811435cb";
const sessionId = `cx_${sessionUuid}`;
const line = (obj: unknown) => JSON.stringify(obj);

let testHome: string;
let previousRoot: string | undefined;

function writeTranscript(contents: string): void {
  const sessionDir = path.join(testHome, ".codex", "sessions", "2026", "07", "03");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(sessionDir, `rollout-2026-07-03-${sessionUuid}.jsonl`), contents);
  clearCodexSessionJsonlPathCache();
}

beforeEach(() => {
  previousRoot = process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
  testHome = mkdtempSync(path.join(tmpdir(), "say-codex-activity-"));
  process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;
  clearCodexSessionJsonlPathCache();
});

afterEach(() => {
  shutdownCodexActivityHub();
  if (previousRoot === undefined) delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
  else process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = previousRoot;
  clearCodexSessionJsonlPathCache();
  rmSync(testHome, { recursive: true, force: true });
});

describe("codex activity hub", () => {
  it("returns limited snapshots from the Codex transcript", async () => {
    writeTranscript(
      [
        line({
          timestamp: "2026-07-03T00:00:00.000Z",
          type: "event_msg",
          payload: { type: "agent_message", message: "Checking files.", phase: "commentary" },
        }),
        line({
          timestamp: "2026-07-03T00:00:01.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "vp check" }),
          },
        }),
      ].join("\n"),
    );

    const snapshot = await getCodexActivitySnapshot(sessionId, 1);

    expect(snapshot).toMatchObject({
      busy: false,
      status: "idle",
      lastTimestamp: Date.parse("2026-07-03T00:00:01.000Z"),
      items: [{ kind: "tool", tool: "exec_command", text: "exec_command vp check" }],
    });
  });
});
