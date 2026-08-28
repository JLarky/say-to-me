import { describe, expect, it } from "vite-plus/test";
import { buildAgentVoicePrompt } from "./agent-voice-prompt.ts";

const noAstro = {
  existsSync: () => false,
  readFileSync: () => {
    throw new Error("should not read");
  },
};

describe("buildAgentVoicePrompt", () => {
  it("keeps the live prompt without --server", () => {
    expect(
      buildAgentVoicePrompt("ses_abc", "hello", {
        ...noAstro,
        env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5411" },
      }),
    ).toBe(
      "you have to reply to this message with voice (cli `say-to-me usage` to learn how/why)\n\nses_abc says: hello",
    );
  });

  it("requires --server on isolated ports", () => {
    expect(
      buildAgentVoicePrompt("cur_abc", "hello", {
        ...noAstro,
        env: { SAY_TO_ME_URL: "http://127.0.0.1:5412" },
      }),
    ).toBe(
      "you have to reply to this message with voice (cli `say-to-me usage` to learn how/why)\nThis session requires `say-to-me api --server http://127.0.0.1:5412` on every call. Do not use say.local.\n\ncur_abc says: hello",
    );
  });
});
