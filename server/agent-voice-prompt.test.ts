import { describe, expect, it } from "vite-plus/test";
import {
  buildAgentVoicePrompt,
  buildAgentVoicePromptFromMessage,
  IDLE_CONTINUE_HEADER,
  USER_CONTINUE_HEADER,
} from "./agent-voice-prompt.ts";

const noAstro = {
  existsSync: () => false,
  readFileSync: () => {
    throw new Error("should not read");
  },
};

const at = new Date("2026-08-29T22:20:00Z");

describe("buildAgentVoicePrompt", () => {
  it("keeps the live user continue without --server and uses said:", () => {
    expect(
      buildAgentVoicePrompt("ses_abc", "hello", {
        ...noAstro,
        at,
        timeZone: "UTC",
        env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5411" },
      }),
    ).toBe(`${USER_CONTINUE_HEADER}\n\nat 22:20 ses_abc said: hello`);
  });

  it("requires --server on isolated ports for user continues", () => {
    expect(
      buildAgentVoicePrompt("cur_abc", "hello", {
        ...noAstro,
        at,
        timeZone: "UTC",
        env: { SAY_TO_ME_URL: "http://127.0.0.1:5412" },
      }),
    ).toBe(
      `${USER_CONTINUE_HEADER}\nThis session requires \`say-to-me api --server http://127.0.0.1:5412\` on every call. Otherwise it will use port 5411.\n\nat 22:20 cur_abc said: hello`,
    );
  });

  it("uses the idle header, names the target, and keeps --server on isolated ports", () => {
    expect(
      buildAgentVoicePrompt("cur_jarvis", "Session is now idle.", {
        ...noAstro,
        at,
        timeZone: "UTC",
        targetSessionId: "cur_worker",
        targetAlias: "review",
        env: { SAY_TO_ME_URL: "http://127.0.0.1:5413" },
      }),
    ).toBe(
      `${IDLE_CONTINUE_HEADER}\nThis session requires \`say-to-me api --server http://127.0.0.1:5413\` on every call. Otherwise it will use port 5411.\n\nat 22:20 cur_jarvis said: say-to-me(cur_worker, review) is now idle.`,
    );
  });

  it("omits --server on idle continues for live 5411", () => {
    expect(
      buildAgentVoicePrompt("cur_jarvis", "Session is now idle.", {
        ...noAstro,
        at,
        timeZone: "UTC",
        targetSessionId: "cur_worker",
        env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5411" },
      }),
    ).toBe(
      `${IDLE_CONTINUE_HEADER}\n\nat 22:20 cur_jarvis said: say-to-me(cur_worker) is now idle.`,
    );
  });

  it("looks up alias from getSession when not provided", () => {
    expect(
      buildAgentVoicePrompt("cur_jarvis", "Session is now idle.", {
        at,
        timeZone: "UTC",
        targetSessionId: "cur_worker",
        lookupAlias: (id) => (id === "cur_worker" ? "review [opus]" : null),
        ...noAstro,
        env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5411" },
      }),
    ).toBe(
      `${IDLE_CONTINUE_HEADER}\n\nat 22:20 cur_jarvis said: say-to-me(cur_worker, review [opus]) is now idle.`,
    );
  });

  it("keeps failed relays on the user continue header", () => {
    expect(
      buildAgentVoicePrompt("cur_jarvis", "Your relay could not be delivered.", {
        at,
        timeZone: "UTC",
        ...noAstro,
        env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5411" },
      }),
    ).toBe(
      `${USER_CONTINUE_HEADER}\n\nat 22:20 cur_jarvis said: Your relay could not be delivered.`,
    );
  });

  it("coalesces multiple idles with per-event clocks", () => {
    expect(
      buildAgentVoicePrompt(
        "cur_jarvis",
        [
          {
            body: "Session is now idle.",
            at: new Date("2026-08-29T20:02:00Z"),
            targetSessionId: "cur_abc",
            targetAlias: "review",
          },
          {
            body: "Session is now idle.",
            at: new Date("2026-08-29T20:05:00Z"),
            targetSessionId: "cx_xyz",
          },
        ],
        {
          timeZone: "UTC",
          ...noAstro,
          env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5411" },
        },
      ),
    ).toBe(
      [
        IDLE_CONTINUE_HEADER,
        "",
        "at 20:02 cur_jarvis said: say-to-me(cur_abc, review) is now idle.",
        "at 20:05 cur_jarvis said: say-to-me(cx_xyz) is now idle.",
      ].join("\n"),
    );
  });

  it("passes through stored coalesced idle clocks without wrapping again", () => {
    const stored = [
      "at 20:02 cur_jarvis said: say-to-me(cur_abc, review) is now idle.",
      "at 20:05 cur_jarvis said: say-to-me(cx_xyz) is now idle.",
    ].join("\n");
    expect(
      buildAgentVoicePrompt("cur_jarvis", stored, {
        ...noAstro,
        env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5411" },
      }),
    ).toBe(`${IDLE_CONTINUE_HEADER}\n\n${stored}`);
  });

  it("builds user continues from stored typed text and delivery-only clocks", () => {
    expect(
      buildAgentVoicePromptFromMessage(
        "ses_abc",
        { text: "typed hello", createdAt: "2026-08-29 22:20:00" },
        { timeZone: "UTC", ...noAstro, env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5411" } },
      ),
    ).toBe(`${USER_CONTINUE_HEADER}\n\nat 22:20 ses_abc said: typed hello`);
  });
});
