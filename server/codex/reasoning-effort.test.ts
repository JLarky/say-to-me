import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const testHome = mkdtempSync(path.join(tmpdir(), "codex-reasoning-effort-home-"));
process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;

const { parseCodexSessionLineReasoningEffort, readCodexSessionReasoningEffort } =
  await import("./reasoning-effort.ts");
const { clearCodexSessionJsonlPathCache } = await import("./resolve.ts");

function writeSession(chatId: string, lines: unknown[]): void {
  const sessionDir = path.join(testHome, ".codex", "sessions", "2026", "07", "12");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    path.join(sessionDir, `rollout-2026-07-12T00-00-00-${chatId}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
}

afterEach(() => clearCodexSessionJsonlPathCache());

describe("Codex reasoning effort", () => {
  it("parses effort from thread settings and turn context records", () => {
    expect(
      parseCodexSessionLineReasoningEffort(
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "thread_settings_applied",
            thread_settings: { reasoning_effort: "medium" },
          },
        }),
      ),
    ).toBe("medium");
    expect(
      parseCodexSessionLineReasoningEffort(
        JSON.stringify({ type: "turn_context", payload: { effort: "high" } }),
      ),
    ).toBe("high");
    expect(
      parseCodexSessionLineReasoningEffort(
        JSON.stringify({ type: "turn_context", payload: { reasoning_effort: "xhigh" } }),
      ),
    ).toBe("xhigh");
  });

  it("chooses the latest valid session-recorded effort", () => {
    const chatId = "519f23a3-2180-77b1-b50e-18f757148705";
    writeSession(chatId, [
      { type: "turn_context", payload: { effort: "low" } },
      { type: "turn_context", payload: { effort: "unsupported" } },
      { type: "event_msg", payload: { thread_settings: { reasoning_effort: "high" } } },
    ]);

    expect(readCodexSessionReasoningEffort(`cx_${chatId}`)).toBe("high");
  });
});
