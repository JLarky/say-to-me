import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const testHome = mkdtempSync(path.join(tmpdir(), "codex-title-home-"));
process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;

const { clearCodexTitleCache, getCodexTitle } = await import("./title.ts");
const { clearCodexSessionJsonlPathCache } = await import("./resolve.ts");

function writeSession(chatId: string, payload: Record<string, unknown>): void {
  const sessionDir = path.join(testHome, ".codex", "sessions", "2026", "07", "05");
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    path.join(sessionDir, `rollout-2026-07-05T10-00-00-${chatId}.jsonl`),
    `${JSON.stringify({ type: "session_meta", payload })}\n`,
  );
}

afterEach(() => {
  clearCodexTitleCache();
  clearCodexSessionJsonlPathCache();
});

describe("getCodexTitle", () => {
  it("returns repo name from git repository_url", () => {
    writeSession("019f2407-2a8d-7380-92fd-90cbbb19a7de", {
      id: "019f2407-2a8d-7380-92fd-90cbbb19a7de",
      git: { repository_url: "https://github.com/JLarky/say-to-me.git", branch: "main" },
    });
    expect(getCodexTitle("cx_019f2407-2a8d-7380-92fd-90cbbb19a7de")).toBe("say-to-me");
  });

  it("appends branch when not main/master", () => {
    writeSession("019f2407-2a8d-7380-92fd-90cbbb19a7de", {
      id: "019f2407-2a8d-7380-92fd-90cbbb19a7de",
      git: { repository_url: "https://github.com/JLarky/say-to-me.git", branch: "feat/something" },
    });
    expect(getCodexTitle("cx_019f2407-2a8d-7380-92fd-90cbbb19a7de")).toBe(
      "say-to-me (feat/something)",
    );
  });

  it("returns null when no session file exists", () => {
    expect(getCodexTitle("cx_00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("returns null when session_meta has no git info", () => {
    writeSession("019f2407-2a8d-7380-92fd-90cbbb19a7de", {
      id: "019f2407-2a8d-7380-92fd-90cbbb19a7de",
      cwd: "/some/dir",
    });
    expect(getCodexTitle("cx_019f2407-2a8d-7380-92fd-90cbbb19a7de")).toBeNull();
  });

  it("strips .git suffix from repo URL", () => {
    writeSession("019f2407-2a8d-7380-92fd-90cbbb19a7de", {
      id: "019f2407-2a8d-7380-92fd-90cbbb19a7de",
      git: { repository_url: "https://github.com/user/repo.git", branch: "master" },
    });
    expect(getCodexTitle("cx_019f2407-2a8d-7380-92fd-90cbbb19a7de")).toBe("repo");
  });

  it("handles repo URL without .git", () => {
    writeSession("019f2407-2a8d-7380-92fd-90cbbb19a7de", {
      id: "019f2407-2a8d-7380-92fd-90cbbb19a7de",
      git: { repository_url: "https://github.com/user/my-project", branch: "dev" },
    });
    expect(getCodexTitle("cx_019f2407-2a8d-7380-92fd-90cbbb19a7de")).toBe("my-project (dev)");
  });

  it("caches titles", () => {
    const chatId = "019f2407-2a8d-7380-92fd-90cbbb19a7de";
    writeSession(chatId, {
      id: chatId,
      git: { repository_url: "https://github.com/foo/bar.git", branch: "main" },
    });
    expect(getCodexTitle(`cx_${chatId}`, 0)).toBe("bar");
    clearCodexSessionJsonlPathCache();
    expect(getCodexTitle(`cx_${chatId}`, 1)).toBe("bar");
  });
});
