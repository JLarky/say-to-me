import { describe, expect, it } from "vite-plus/test";
import {
  browserSpeechText,
  buildPaseoAgentNameMap,
  paseoChatListenerStatus,
  preferredBrowserSpeechVoice,
  sessionIdWithDisplayName,
  sessionMessageRequestBody,
  shouldAutoplayMessage,
  shouldShushPlayback,
  speechTextWithAgentNames,
} from "./session-page-helpers.ts";
import { createPendingMessage, formatMessageTime, shouldSubmitComposerKey } from "./utils.ts";
import type { Message } from "./types.ts";

function message(overrides: Partial<Message>): Message {
  return {
    id: 1,
    text: "Long agent message",
    status: "speaking",
    author: "agent",
    sessionId: "default",
    ...overrides,
  };
}

describe("session page helpers", () => {
  it("submits the composer only for plain Enter outside IME composition", () => {
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: false },
      }),
    ).toBe(true);
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: true,
        nativeEvent: { isComposing: false },
      }),
    ).toBe(false);
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
      }),
    ).toBe(false);
    expect(
      shouldSubmitComposerKey({ key: "a", shiftKey: false, nativeEvent: { isComposing: false } }),
    ).toBe(false);
  });

  it("describes Paseo chat listening from the session archive state", () => {
    expect(paseoChatListenerStatus({ backend: "paseo-chat", state: "general" })).toEqual({
      active: true,
      label: "Paseo chat listening",
    });
    expect(paseoChatListenerStatus({ backend: "paseo-chat", state: "archived" })).toEqual({
      active: false,
      label: "Paseo chat listening paused (archived)",
    });
    expect(paseoChatListenerStatus({ backend: "opencode", state: "general" })).toBe(null);
  });

  it("only applies shush mode to automatic playback", () => {
    expect(shouldShushPlayback("shush", { respectShush: true })).toBe(true);
    expect(shouldShushPlayback("shush")).toBe(false);
    expect(shouldShushPlayback("speak", { respectShush: true })).toBe(false);
  });

  it("autoplays fresh idle notifications through the message queue", () => {
    const idle = message({
      id: 12,
      author: "user",
      status: "received",
      text: "<say-to-me-system>ses_09a0fc08523fctVzW8czyW9yAN is idle now</say-to-me-system>",
    });

    expect(shouldAutoplayMessage(idle, new Set())).toBe(false);
    expect(shouldAutoplayMessage(idle, new Set([12]))).toBe(true);
    expect(shouldAutoplayMessage(message({ id: 13, status: "queued" }), new Set())).toBe(true);
  });

  it("formats the session subtitle with the display alias", () => {
    expect(sessionIdWithDisplayName("ses_0c86bae7a382nqSq8a8aiVoQcZ", "Alfred")).toBe(
      "ses_0c86bae7a382nqSq8a8aiVoQcZ Alfred",
    );
    expect(sessionIdWithDisplayName("ses_0c86bae7a382nqSq8a8aiVoQcZ", "  Alfred  ")).toBe(
      "ses_0c86bae7a382nqSq8a8aiVoQcZ Alfred",
    );
    expect(sessionIdWithDisplayName("ses_0c86bae7a382nqSq8a8aiVoQcZ", null)).toBe(
      "ses_0c86bae7a382nqSq8a8aiVoQcZ",
    );
  });

  it("prefers Microsoft Emma for browser speech when available", () => {
    const emma = {
      name: "Microsoft Emma Online (Natural) - English (United States)",
      lang: "en-US",
    };
    expect(
      preferredBrowserSpeechVoice([
        { name: "Microsoft Brian Online (Natural) - English (United States)", lang: "en-US" },
        {
          name: "Microsoft EmmaMultilingual Online (Natural) - English (United States)",
          lang: "en-US",
        },
        emma,
      ]),
    ).toBe(emma);
  });

  it("builds a Paseo agent name map from message author badges", () => {
    const map = buildPaseoAgentNameMap([
      {
        paseoAuthor: "2427004a-6974-49c8-a339-958686a4fd5d",
        paseoAuthorName: "STM paseo chat",
      },
      {
        paseoAuthor: "45f60d0d-2d76-49ca-9509-9c1bc77cc95f",
        paseoAuthorName: "Effect expert",
      },
      { paseoAuthor: "manual", paseoAuthorName: null },
      {
        paseoAuthor: "45f60d0d-2d76-49ca-9509-9c1bc77cc95f",
        paseoAuthorName: "Effect expert renamed",
      },
    ]);
    expect(map.get("45f60d0d-2d76-49ca-9509-9c1bc77cc95f")).toBe("Effect expert renamed");
    expect(map.get("2427004a-6974-49c8-a339-958686a4fd5d")).toBe("STM paseo chat");
    expect(map.has("manual")).toBe(false);
  });

  it("rewrites @agent-uuid mentions to names or short ids for TTS", () => {
    const names = new Map([
      ["8f70ea38-319a-478a-92b2-2c3cd13f35cf", "STM paseo chat e2e"],
      ["45f60d0d-2d76-49ca-9509-9c1bc77cc95f", "Effect expert"],
    ]);
    const raw =
      "@8f70ea38-319a-478a-92b2-2c3cd13f35cf @45f60d0d-2d76-49ca-9509-9c1bc77cc95f Draft PR up.";
    expect(speechTextWithAgentNames(raw, names)).toBe(
      "STM paseo chat e2e Effect expert Draft PR up.",
    );
    expect(speechTextWithAgentNames("@00000000-0000-4000-8000-000000000000 unknown", names)).toBe(
      "0000000 unknown",
    );
  });

  it("uses agent-name rewrite for browser speech of ordinary messages", () => {
    const text = "@2427004a-6974-49c8-a339-958686a4fd5d please re-review when ready.";
    expect(
      browserSpeechText({ text }, { "2427004a-6974-49c8-a339-958686a4fd5d": "STM paseo chat" }),
    ).toBe("STM paseo chat please re-review when ready.");
    expect(browserSpeechText({ text })).toBe("2427004 please re-review when ready.");
  });

  it("falls back to Google US English when Emma is unavailable", () => {
    const google = { name: "Google US English", lang: "en-US" };
    expect(
      preferredBrowserSpeechVoice([
        { name: "Default", lang: "en-US" },
        google,
        {
          name: "Microsoft EmmaMultilingual Online (Natural) - English (United States)",
          lang: "en-US",
        },
        { name: "Microsoft Brian Online (Natural) - English (United States)", lang: "en-US" },
      ]),
    ).toBe(google);
  });

  it("uses the browser default voice when preferred voices are unavailable", () => {
    expect(
      preferredBrowserSpeechVoice([
        { name: "Default", lang: "en-US" },
        { name: "Microsoft Brian Online (Natural) - English (United States)", lang: "en-US" },
      ]),
    ).toBe(null);
  });

  it("formats message timestamps by recency", () => {
    const now = new Date("2026-05-14T12:00:00Z");

    expect(formatMessageTime("2026-05-14 11:59:45", now)).toBe("just now");
    expect(formatMessageTime("2026-05-14 11:45:00", now)).toBe("15m ago");
    expect(formatMessageTime("2026-05-14 09:30:00", now)).toMatch(/\d{1,2}:30/);
    expect(formatMessageTime("2026-05-13 11:30:00", now)).toMatch(/May 13/);
  });

  it("includes notify-on-completion in the session message API body", () => {
    expect(
      sessionMessageRequestBody(
        createPendingMessage({
          author: "user",
          sessionId: "default",
          text: "please sleep 5 seconds",
          id: "pending-relay-no-notify",
          notifyOnCompletion: false,
          targetSessionId: "ses_12f94ae96ffepCN7Wdi3ZUA7zl",
        }),
      ),
    ).toMatchObject({
      notifyOnCompletion: false,
      targetSessionId: "ses_12f94ae96ffepCN7Wdi3ZUA7zl",
    });
  });
});
