import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const testHome = mkdtempSync(path.join(tmpdir(), "grok-title-home-"));
process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;

const { clearGrokTitleCache, getGrokTitle } = await import("./title.ts");

afterEach(() => {
  clearGrokTitleCache();
});

describe("getGrokTitle", () => {
  const sessionId = "gr_019f2407-2a8d-7380-92fd-90cbbb19a7de";
  const chatId = "019f2407-2a8d-7380-92fd-90cbbb19a7de";
  const projectDir = "my-project";

  it("reads title from summary.json and caches it", () => {
    const dir = path.join(testHome, ".grok", "sessions", projectDir, chatId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ title: "Fix the bug" }));

    const now = 1_000;
    expect(getGrokTitle(sessionId, now)).toBe("Fix the bug");
    expect(getGrokTitle(sessionId, now + 1)).toBe("Fix the bug");
  });

  it("returns cached title within TTL even if underlying file changes", () => {
    const dir = path.join(testHome, ".grok", "sessions", projectDir, chatId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ title: "First title" }));

    const now = 2_000;
    expect(getGrokTitle(sessionId, now)).toBe("First title");

    // Underlying file changes, but cache is within TTL
    writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ title: "Second title" }));
    expect(getGrokTitle(sessionId, now + 30_000)).toBe("First title");

    // After clear, reads fresh
    clearGrokTitleCache();
    expect(getGrokTitle(sessionId, now + 30_001)).toBe("Second title");
  });

  it("returns null when no summary.json exists", () => {
    const now = 3_000;
    expect(getGrokTitle("gr_219f2407-2a8d-7380-92fd-90cbbb19a7de", now)).toBeNull();
  });

  it("returns null for missing title field", () => {
    const dir = path.join(testHome, ".grok", "sessions", projectDir, `${chatId}-empty`);
    const sid = `gr_${path.basename(dir)}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "summary.json"), JSON.stringify({}));

    expect(getGrokTitle(sid, 4_000)).toBeNull();
  });
});
