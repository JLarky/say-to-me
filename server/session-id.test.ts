import { describe, expect, it } from "vite-plus/test";
import {
  claudeSessionUuid,
  codexSessionUuid,
  cursorSessionUuid,
  detectSessionBackend,
  isClaudeSessionId,
  isCodexSessionId,
  isCursorSessionId,
  isOpenCodeSessionId,
  isT3SessionId,
  isPaseoChatSessionId,
  isPaseoSessionId,
  normalizeSessionId,
  toClaudeSessionId,
  toCodexSessionId,
  toCursorSessionId,
  toT3SessionId,
  toPaseoChatSessionId,
  toPaseoSessionId,
  validateSessionId,
} from "./session-id.ts";
import { Session } from "../src/types.ts";

const openCodeId = "ses_1dd864100ffes6uqv2NbJatAKt";
const claudeUuid = "5c708e22-807e-4579-807a-b56d8e4341e1";
const claudeId = `cc_${claudeUuid}`;
const cursorUuid = "a35fda79-2e0e-4884-9085-0a250ef8f965";
const cursorId = `cur_${cursorUuid}`;
const codexUuid = "b1b2b3b4-b5b6-4788-9085-0a250ef8f966";
const codexId = `cx_${codexUuid}`;

describe("session id classification", () => {
  it("detects OpenCode ids", () => {
    expect(isOpenCodeSessionId(openCodeId)).toBe(true);
    expect(isOpenCodeSessionId(claudeId)).toBe(false);
    expect(detectSessionBackend(openCodeId)).toBe("opencode");
  });

  it("rejects junk ses_ ids that are not real OpenCode shapes", () => {
    expect(isOpenCodeSessionId("ses_ses")).toBe(false);
    expect(detectSessionBackend("ses_ses")).toBe("none");
    expect(isOpenCodeSessionId("ses_sseSource")).toBe(false);
    expect(detectSessionBackend("ses_sseSource")).toBe("none");
    expect(isOpenCodeSessionId("ses_sseTarget")).toBe(false);
    expect(detectSessionBackend("ses_sseTarget")).toBe("none");
    expect(isOpenCodeSessionId("ses_test")).toBe(false);
    expect(detectSessionBackend("ses_test")).toBe("none");
  });

  it("rejects the 24-hex artifact that matched the old {12,14} tail", () => {
    const artifact = "ses_0a9fdff38ae3cee51001df32";
    expect(artifact.length - "ses_".length).toBe(24);
    expect(isOpenCodeSessionId(artifact)).toBe(false);
    expect(detectSessionBackend(artifact)).toBe("none");
  });

  it("detects voice-only vo_ ids", () => {
    expect(detectSessionBackend("vo_shopping-notes")).toBe("voice");
    expect(detectSessionBackend("vo_a")).toBe("voice");
    expect(detectSessionBackend("vo_")).toBe("none");
  });

  it("detects Claude ids by their cc_ prefix (case-insensitive)", () => {
    expect(isClaudeSessionId(claudeId)).toBe(true);
    expect(isClaudeSessionId(claudeId.toUpperCase())).toBe(true);
    expect(detectSessionBackend(claudeId)).toBe("claude");
    expect(isClaudeSessionId(claudeUuid)).toBe(false);
    expect(detectSessionBackend(claudeUuid)).toBe("none");
  });

  it("detects Cursor ids by their cur_ prefix (case-insensitive)", () => {
    expect(isCursorSessionId(cursorId)).toBe(true);
    expect(isCursorSessionId(cursorId.toUpperCase())).toBe(true);
    expect(detectSessionBackend(cursorId)).toBe("cursor");
    expect(isCursorSessionId(cursorUuid)).toBe(false);
    expect(detectSessionBackend(cursorUuid)).toBe("none");
  });

  it("detects Codex ids by their cx_ prefix (case-insensitive)", () => {
    expect(isCodexSessionId(codexId)).toBe(true);
    expect(isCodexSessionId(codexId.toUpperCase())).toBe(true);
    expect(detectSessionBackend(codexId)).toBe("codex");
    expect(isCodexSessionId(codexUuid)).toBe(false);
    expect(detectSessionBackend(codexUuid)).toBe("none");
  });

  it("detects T3 ids by their t3_ prefix", () => {
    const t3Uuid = "7f110cc6-2117-41eb-ae68-142750ad4322";
    const t3Id = `t3_${t3Uuid}`;
    expect(isT3SessionId(t3Id)).toBe(true);
    expect(detectSessionBackend(t3Id)).toBe("t3");
    expect(toT3SessionId(t3Uuid)).toBe(t3Id);
    expect(isT3SessionId(t3Uuid)).toBe(false);
    expect(detectSessionBackend(t3Uuid)).toBe("none");
  });

  it("detects Paseo ids by their pa_ prefix", () => {
    const uuid = "7f110cc6-2117-41eb-ae68-142750ad4322";
    const id = `pa_${uuid}`;
    expect(isPaseoSessionId(id)).toBe(true);
    expect(detectSessionBackend(id)).toBe("paseo");
    expect(toPaseoSessionId(uuid)).toBe(id);
  });

  it("detects Paseo chat ids by their pc_ prefix", () => {
    const uuid = "8f110cc6-2117-41eb-ae68-142750ad4322";
    const id = `pc_${uuid}`;
    expect(isPaseoChatSessionId(id)).toBe(true);
    expect(detectSessionBackend(id)).toBe("paseo-chat");
    expect(toPaseoChatSessionId(uuid)).toBe(id);
  });

  it("treats default/empty/unknown as none", () => {
    expect(detectSessionBackend("default")).toBe("none");
    expect(detectSessionBackend("")).toBe("none");
    expect(detectSessionBackend(null)).toBe("none");
    expect(detectSessionBackend("my-notes")).toBe("none");
  });

  it("emits only backends the client Session schema accepts", () => {
    const uuid = "8f110cc6-2117-41eb-ae68-142750ad4322";
    const ids = [
      "ses_1dd864100ffes6uqv2NbJatAKt",
      `cc_${uuid}`,
      `cur_${uuid}`,
      `cx_${uuid}`,
      `gr_${uuid}`,
      `t3_${uuid}`,
      `pa_${uuid}`,
      `pc_${uuid}`,
      "vo_shopping-notes",
      "my-notes",
    ];
    for (const id of ids) {
      expect(() => Session.assert({ id, backend: detectSessionBackend(id) })).not.toThrow();
    }
  });
});

describe("prefixed uuid session ids", () => {
  it("strips provider prefixes to the underlying uuid", () => {
    expect(claudeSessionUuid(claudeId)).toBe(claudeUuid);
    expect(cursorSessionUuid(cursorId)).toBe(cursorUuid);
    expect(codexSessionUuid(codexId)).toBe(codexUuid);
  });

  it("builds prefixed ids from a raw uuid or an already-prefixed id", () => {
    expect(toClaudeSessionId(claudeUuid)).toBe(claudeId);
    expect(toClaudeSessionId(claudeId)).toBe(claudeId);
    expect(toCursorSessionId(cursorUuid)).toBe(cursorId);
    expect(toCursorSessionId(cursorId)).toBe(cursorId);
    expect(toCodexSessionId(codexUuid)).toBe(codexId);
    expect(toCodexSessionId(codexId)).toBe(codexId);
    expect(toCursorSessionId("not-a-uuid")).toBe(null);
    expect(toClaudeSessionId(openCodeId)).toBe(null);
  });
});

describe("validateSessionId (OpenCode-only gate, unchanged)", () => {
  it("passes only OpenCode ids and null", () => {
    expect(validateSessionId(openCodeId)).toBe(true);
    expect(validateSessionId(null)).toBe(true);
    expect(validateSessionId(claudeId)).toBe(false);
    expect(validateSessionId(cursorId)).toBe(false);
    expect(validateSessionId("default")).toBe(false);
  });
});

describe("normalizeSessionId broadening", () => {
  it("keeps default for empty/null/default", () => {
    expect(normalizeSessionId(undefined)).toBe("default");
    expect(normalizeSessionId(null)).toBe("default");
    expect(normalizeSessionId("")).toBe("default");
    expect(normalizeSessionId("default")).toBe("default");
  });

  it("accepts opencode, claude, cursor, voice, and conservative fallback ids", () => {
    expect(normalizeSessionId(openCodeId)).toBe(openCodeId);
    expect(normalizeSessionId(claudeId)).toBe(claudeId);
    expect(normalizeSessionId(cursorId)).toBe(cursorId);
    expect(normalizeSessionId(codexId)).toBe(codexId);
    expect(normalizeSessionId("vo_shopping-notes")).toBe("vo_shopping-notes");
    expect(normalizeSessionId("my-notes")).toBe("my-notes");
  });

  it("rejects ids with unsafe characters", () => {
    expect(normalizeSessionId("../etc/passwd")).toBe(null);
    expect(normalizeSessionId("has space")).toBe(null);
    expect(normalizeSessionId("a/b")).toBe(null);
  });
});
