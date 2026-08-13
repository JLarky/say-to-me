import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { claudeProjectDirName } from "../claude/delivery.ts";
import { cursorProjectDirName } from "../cursor/delivery.ts";
import { grokProjectDirName } from "../grok/delivery.ts";

const testHome = mkdtempSync(path.join(tmpdir(), "discover-sessions-home-"));
const testDbDir = mkdtempSync(path.join(tmpdir(), "discover-sessions-db-"));
process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { discoverExternalCliSessions } = await import("./discover-sessions.ts");

describe("discoverExternalCliSessions", () => {
  beforeEach(() => {
    process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;
  });
  it("lists Claude sessions for a project directory", () => {
    const repoCwd = mkdtempSync(path.join(testHome, "claude-repo-"));
    const chatId = randomUUID();
    const projectDir = path.join(testHome, ".claude", "projects", claudeProjectDirName(repoCwd));
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      path.join(projectDir, `${chatId}.jsonl`),
      `${JSON.stringify({ type: "summary", aiTitle: "Fix import page" })}\n`,
    );

    const result = discoverExternalCliSessions("claude", repoCwd);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(repoCwd);
    expect(result.sessions).toEqual([
      {
        sessionId: `cc_${chatId}`,
        chatId,
        title: "Fix import page",
        modifiedAt: expect.any(Number),
        imported: false,
      },
    ]);
  });

  it("lists Codex sessions whose session_meta cwd matches the folder", () => {
    const repoCwd = mkdtempSync(path.join(testHome, "codex-repo-"));
    const chatId = "b2b2b2b2-2222-4222-8222-222222222222";
    const sessionDir = path.join(testHome, ".codex", "sessions", "2026", "07", "02");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, `rollout-2026-07-02T12-11-17-${chatId}.jsonl`),
      `${JSON.stringify({
        type: "session_meta",
        payload: {
          id: chatId,
          cwd: repoCwd,
          git: { repository_url: "https://github.com/JLarky/say-to-me.git", branch: "main" },
        },
      })}\n`,
    );

    const result = discoverExternalCliSessions("codex", repoCwd);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toEqual([
      {
        sessionId: `cx_${chatId}`,
        chatId,
        title: "say-to-me",
        modifiedAt: expect.any(Number),
        imported: false,
      },
    ]);
  });

  it("lists Cursor sessions for a project directory", () => {
    const repoCwd = mkdtempSync(path.join(testHome, "cursor-repo-"));
    const chatId = "c3c3c3c3-3333-4333-8333-333333333333";
    const transcriptDir = path.join(
      testHome,
      ".cursor",
      "projects",
      cursorProjectDirName(repoCwd),
      "agent-transcripts",
      chatId,
    );
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(path.join(transcriptDir, `${chatId}.jsonl`), '{"role":"user"}\n');
    const metaDir = path.join(testHome, ".cursor", "chats", "hash-dir", chatId);
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(path.join(metaDir, "meta.json"), JSON.stringify({ title: "Cursor import test" }));

    const result = discoverExternalCliSessions("cursor", repoCwd);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toEqual([
      {
        sessionId: `cur_${chatId}`,
        chatId,
        title: "Cursor import test",
        modifiedAt: expect.any(Number),
        imported: false,
      },
    ]);
  });

  it("lists Grok sessions for a project directory", () => {
    const repoCwd = mkdtempSync(path.join(testHome, "grok-repo-"));
    const chatId = "d4d4d4d4-4444-4444-8444-444444444444";
    const sessionDir = path.join(
      testHome,
      ".grok",
      "sessions",
      grokProjectDirName(repoCwd),
      chatId,
    );
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(path.join(sessionDir, "chat_history.jsonl"), '{"role":"user"}\n');
    writeFileSync(
      path.join(sessionDir, "summary.json"),
      JSON.stringify({ title: "Grok import test" }),
    );

    const result = discoverExternalCliSessions("grok", repoCwd);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toEqual([
      {
        sessionId: `gr_${chatId}`,
        chatId,
        title: "Grok import test",
        modifiedAt: expect.any(Number),
        imported: false,
      },
    ]);
  });

  it("rejects missing folders", () => {
    expect(discoverExternalCliSessions("claude", "/tmp/does-not-exist-discover-test")).toEqual({
      ok: false,
      error: "Folder does not exist.",
    });
  });
});
