import { describe, expect, it } from "vite-plus/test";
import { extractLeadingSessionMessage, extractSessionMentions } from "./session-mentions.ts";

const opencodeId = "ses_1dd864100ffes6uqv2NbJatAKt";
const claudeId = "cc_5c708e22-807e-4579-807a-b56d8e4341e1";
const cursorId = "cur_a35fda79-2e0e-4884-9085-0a250ef8f965";
const t3Id = "t3_5c708e22-807e-4579-807a-b56d8e4341e1";

describe("session mentions", () => {
  it("extracts a leading say-to-me mention for OpenCode and external CLI ids", () => {
    expect(extractLeadingSessionMessage(`say-to-me(${opencodeId}) hi`)).toEqual({
      session: { id: opencodeId, alias: null },
      text: "hi",
    });
    expect(extractLeadingSessionMessage(`say-to-me(${claudeId}, E2E) reply okay`)).toEqual({
      session: { id: claudeId, alias: "E2E" },
      text: "reply okay",
    });
    expect(extractLeadingSessionMessage(`say-to-me(${cursorId}) hi`)).toEqual({
      session: { id: cursorId, alias: null },
      text: "hi",
    });
    expect(extractLeadingSessionMessage(`say-to-me(${t3Id}) hi`)).toEqual({
      session: { id: t3Id, alias: null },
      text: "hi",
    });
  });

  it("collects external CLI ids as references (token and raw)", () => {
    expect(extractSessionMentions(`see say-to-me(${claudeId})`)).toEqual([
      { id: claudeId, alias: null },
    ]);
    expect(extractSessionMentions(`ping ${claudeId}`)).toEqual([{ id: claudeId, alias: null }]);
    expect(extractSessionMentions(`ping ${cursorId}`)).toEqual([{ id: cursorId, alias: null }]);
  });
});
