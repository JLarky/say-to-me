import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const testHome = mkdtempSync(path.join(tmpdir(), "codex-resolve-home-"));
process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;

const { clearCodexSessionJsonlPathCache, codexCwdFromSessionPath, codexSessionJsonlPath } =
  await import("./resolve.ts");
const { resolveExternalCliSession } = await import("../external-cli/resolve-provider.ts");

afterEach(() => {
  clearCodexSessionJsonlPathCache();
});

describe("codex session resolve", () => {
  const chatId = "019f2407-2a8d-7380-92fd-90cbbb19a7de";
  const repoCwd = "/Users/jlarky/vm/JLarky/say-to-me";

  it("finds rollout jsonl and reads cwd from session_meta", () => {
    const sessionDir = path.join(testHome, ".codex", "sessions", "2026", "07", "02");
    mkdirSync(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, `rollout-2026-07-02T12-11-17-${chatId}.jsonl`);
    writeFileSync(
      sessionPath,
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: chatId, cwd: repoCwd },
      })}\n`,
    );

    expect(codexSessionJsonlPath(chatId)).toBe(sessionPath);
    expect(codexCwdFromSessionPath(sessionPath)).toBe(repoCwd);
    expect(resolveExternalCliSession(chatId)).toEqual({
      provider: "codex",
      ambiguous: false,
      cwd: repoCwd,
    });
    expect(resolveExternalCliSession(`cx_${chatId}`)).toEqual({
      provider: "codex",
      ambiguous: false,
      cwd: repoCwd,
    });
  });

  it("caches found rollout paths across repeated lookups", () => {
    const sessionDir = path.join(testHome, ".codex", "sessions", "2026", "07", "02");
    mkdirSync(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, `rollout-2026-07-02T12-11-17-${chatId}.jsonl`);
    writeFileSync(sessionPath, "");

    expect(codexSessionJsonlPath(chatId)).toBe(sessionPath);
    expect(codexSessionJsonlPath(chatId)).toBe(sessionPath);
  });

  it("memoizes missing rollout paths until the cache is cleared or expired", () => {
    const missingChatId = "119f2407-2a8d-7380-92fd-90cbbb19a7de";
    const sessionDir = path.join(testHome, ".codex", "sessions", "2026", "07", "03");
    const sessionPath = path.join(sessionDir, `rollout-2026-07-03T12-11-17-${missingChatId}.jsonl`);
    const now = 1_000;

    expect(codexSessionJsonlPath(missingChatId, now)).toBeNull();

    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(sessionPath, "");
    expect(codexSessionJsonlPath(missingChatId, now + 9_999)).toBeNull();
    expect(codexSessionJsonlPath(missingChatId, now + 10_001)).toBe(sessionPath);

    clearCodexSessionJsonlPathCache();
    expect(codexSessionJsonlPath(missingChatId, now)).toBe(sessionPath);
  });
});
