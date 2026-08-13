import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { cursorProjectDirName } from "../cursor/delivery.ts";

const testHome = mkdtempSync(path.join(tmpdir(), "resolve-provider-home-"));
process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;

const {
  cwdFromProjectSlug,
  externalCliSessionExists,
  isBareExternalCliUuid,
  resolveExternalCliSession,
} = await import("./resolve-provider.ts");

describe("resolveExternalCliSession", () => {
  const chatId = "a35fda79-2e0e-4884-9085-0a250ef8f965";

  beforeEach(() => {
    process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;
  });

  it("recognizes bare uuids", () => {
    expect(isBareExternalCliUuid(chatId)).toBe(true);
    expect(isBareExternalCliUuid(`cc_${chatId}`)).toBe(false);
    expect(isBareExternalCliUuid(`cx_${chatId}`)).toBe(false);
  });

  it("resolves a Codex session id from rollout jsonl session_meta cwd", () => {
    const chatId = "f1f1f1f1-1111-4111-8111-111111111111";
    const repoCwd = mkdtempSync(path.join(testHome, "codex-repo-"));
    const sessionDir = path.join(testHome, ".codex", "sessions", "2026", "07", "02");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, `rollout-2026-07-02T12-11-17-${chatId}.jsonl`),
      `${JSON.stringify({ type: "session_meta", payload: { id: chatId, cwd: repoCwd } })}\n`,
    );

    const result = resolveExternalCliSession(`cx_${chatId}`);
    expect(result).toEqual({ provider: "codex", ambiguous: false, cwd: repoCwd });
  });

  it("resolves a Cursor chat from local transcript files and infers cwd", () => {
    const repoCwd = mkdtempSync(path.join(testHome, "repo-"));
    const slug = cursorProjectDirName(repoCwd);
    const transcriptDir = path.join(
      testHome,
      ".cursor",
      "projects",
      slug,
      "agent-transcripts",
      chatId,
    );
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(path.join(transcriptDir, `${chatId}.jsonl`), '{"role":"user"}\n');

    const result = resolveExternalCliSession(chatId);
    expect(result).toEqual({ provider: "cursor", ambiguous: false, cwd: repoCwd });
  });

  it("uses Cursor chat metadata when the project slug normalizes dots", () => {
    const repoCwd = path.join(testHome, "cursor.home", "repo");
    const chatId = "d46f2e6b-0c9b-4d8a-9f22-8c7af6d6f4a1";
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
    writeFileSync(path.join(metaDir, "meta.json"), JSON.stringify({ cwd: repoCwd }));

    const result = resolveExternalCliSession(`cur_${chatId}`);
    expect(result).toEqual({ provider: "cursor", ambiguous: false, cwd: repoCwd });
  });

  it("resolves a metadata-only Cursor chat without a transcript", () => {
    const repoCwd = path.join(testHome, "metadata-only.repo");
    const chatId = "e57d6f18-c1b7-4f2c-8dd6-8ccf3c2f4f1a";
    mkdirSync(repoCwd, { recursive: true });
    const metaDir = path.join(testHome, ".cursor", "chats", "metadata-only", chatId);
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(path.join(metaDir, "meta.json"), JSON.stringify({ cwd: repoCwd }));

    expect(externalCliSessionExists(`cur_${chatId}`)).toBe(true);
    expect(resolveExternalCliSession(`cur_${chatId}`)).toEqual({
      provider: "cursor",
      ambiguous: false,
      cwd: repoCwd,
    });
  });

  it("decodes dashed project slugs like say-to-me", () => {
    const dashedRepo = path.join(testHome, "vm", "JLarky", "say-to-me");
    mkdirSync(dashedRepo, { recursive: true });
    const slug = cursorProjectDirName(dashedRepo);
    expect(cwdFromProjectSlug(slug, "cursor")).toBe(dashedRepo);
  });

  it("resolves Claude cwd from session jsonl when slug decoding fails", () => {
    const chatId = "5146e06f-df15-428b-8847-e147652444a0";
    const repoCwd = "/home/jlarky.guest/work/demo-project";
    const slug = "-home-jlarky-guest-work-demo-project";
    const projectDir = path.join(testHome, ".claude", "projects", slug);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      path.join(projectDir, `${chatId}.jsonl`),
      [
        '{"type":"mode","mode":"normal","sessionId":"5146e06f-df15-428b-8847-e147652444a0"}',
        `{"type":"user","cwd":"${repoCwd}","sessionId":"${chatId}"}`,
      ].join("\n"),
    );

    const result = resolveExternalCliSession(chatId);
    expect(result).toEqual({ provider: "claude", ambiguous: false, cwd: repoCwd });
  });
});
