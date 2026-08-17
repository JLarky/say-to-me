import { Effect } from "effect";
import type { JsonValue } from "@say-to-me/runtime-validation";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildSessionMessageCommand } from "./message-command.ts";
import { SPELLED_NUMBER_WORDS_ERROR } from "./validation.ts";

const sourceSessionId = "ses_12345678901234567890123456";
const targetSessionId = "ses_abcdef012345ABCDEFGHJKLMNO";
const voiceSessionId = "vo_shopping-notes";

async function build(body: JsonValue, rawSessionId = sourceSessionId) {
  return Effect.runPromise(buildSessionMessageCommand({ body, rawSessionId }));
}

async function fail(body: JsonValue, rawSessionId = sourceSessionId) {
  return Effect.runPromise(Effect.flip(buildSessionMessageCommand({ body, rawSessionId })));
}

describe("buildSessionMessageCommand", () => {
  const previousLimits = {
    min: process.env.SAY_TO_ME_MIN_MESSAGE_LENGTH,
    max: process.env.SAY_TO_ME_MAX_MESSAGE_LENGTH,
    maxUser: process.env.SAY_TO_ME_MAX_USER_MESSAGE_LENGTH,
  };

  beforeEach(() => {
    // Exercise production defaults, not the tighter API harness limits.
    process.env.SAY_TO_ME_MIN_MESSAGE_LENGTH = "1";
    process.env.SAY_TO_ME_MAX_MESSAGE_LENGTH = "4000";
    process.env.SAY_TO_ME_MAX_USER_MESSAGE_LENGTH = "32000";
  });

  afterEach(() => {
    if (previousLimits.min === undefined) delete process.env.SAY_TO_ME_MIN_MESSAGE_LENGTH;
    else process.env.SAY_TO_ME_MIN_MESSAGE_LENGTH = previousLimits.min;
    if (previousLimits.max === undefined) delete process.env.SAY_TO_ME_MAX_MESSAGE_LENGTH;
    else process.env.SAY_TO_ME_MAX_MESSAGE_LENGTH = previousLimits.max;
    if (previousLimits.maxUser === undefined) delete process.env.SAY_TO_ME_MAX_USER_MESSAGE_LENGTH;
    else process.env.SAY_TO_ME_MAX_USER_MESSAGE_LENGTH = previousLimits.maxUser;
  });
  it("builds a direct message command", async () => {
    await expect(
      build({
        author: "user",
        clientMessageId: "client-1",
        links: ["https://example.test"],
        sessions: [{ alias: "Helper", id: targetSessionId }],
        text: "hello there",
      }),
    ).resolves.toMatchObject({
      author: "user",
      clientMessageId: "client-1",
      links: ["https://example.test"],
      notifyOnCompletion: false,
      sessionId: sourceSessionId,
      sessionRefs: [{ alias: "Helper", id: targetSessionId }],
      text: "hello there",
      type: "direct",
    });
  });

  it("accepts every external CLI provider id in session cards and forward targets", async () => {
    const claudeId = "cc_5c708e22-807e-4579-807a-b56d8e4341e1";
    const cursorId = "cur_a35fda79-2e0e-4884-9085-0a250ef8f965";
    const codexId = "cx_7c708e22-807e-4579-807a-b56d8e4341e1";
    const grokId = "gr_8c708e22-807e-4579-807a-b56d8e4341e1";
    const t3Id = "t3_9c708e22-807e-4579-807a-b56d8e4341e1";
    await expect(
      build({
        author: "agent",
        sessions: [
          { alias: "Claude", id: claudeId },
          { alias: "Cursor", id: cursorId },
          { alias: "Codex", id: codexId },
          { alias: "Grok", id: grokId },
          { alias: "T3", id: t3Id },
        ],
        text: "see these sessions",
      }),
    ).resolves.toMatchObject({
      sessionRefs: [
        { alias: "Claude", id: claudeId },
        { alias: "Cursor", id: cursorId },
        { alias: "Codex", id: codexId },
        { alias: "Grok", id: grokId },
        { alias: "T3", id: t3Id },
      ],
      type: "direct",
    });
    await expect(
      build({ author: "user", targetSessionId: claudeId, text: "relay this" }),
    ).resolves.toMatchObject({ targetSessionId: claudeId, type: "forward" });
    await expect(
      build({ author: "user", targetSessionId: cursorId, text: "relay to cursor" }),
    ).resolves.toMatchObject({ targetSessionId: cursorId, type: "forward" });
    await expect(
      build({ author: "user", targetSessionId: codexId, text: "relay to codex" }),
    ).resolves.toMatchObject({ targetSessionId: codexId, type: "forward" });
    await expect(
      build({ author: "user", targetSessionId: grokId, text: "relay to grok" }),
    ).resolves.toMatchObject({ targetSessionId: grokId, type: "forward" });
    await expect(
      build({ author: "user", targetSessionId: t3Id, text: "relay to t3" }),
    ).resolves.toMatchObject({ targetSessionId: t3Id, type: "forward" });
  });

  it("defaults notify-on-completion differently for direct and forwarded messages", async () => {
    await expect(build({ author: "user", text: "direct" })).resolves.toMatchObject({
      notifyOnCompletion: false,
      type: "direct",
    });
    await expect(
      build({ author: "user", targetSessionId, text: "forward this" }),
    ).resolves.toMatchObject({ notifyOnCompletion: true, targetSessionId, type: "forward" });
    await expect(
      build({ author: "user", notifyOnCompletion: false, targetSessionId, text: "forward this" }),
    ).resolves.toMatchObject({ notifyOnCompletion: false, targetSessionId, type: "forward" });
    await expect(
      build({ author: "user", notifyOnCompletion: true, text: "direct watch" }),
    ).resolves.toMatchObject({ notifyOnCompletion: true, type: "direct" });
  });

  it("extracts leading relay targets for user messages", async () => {
    await expect(
      build({ author: "user", text: `say-to-me(${targetSessionId}, Pairing buddy) please check` }),
    ).resolves.toMatchObject({
      leadingRelay: {
        session: { alias: "Pairing buddy", id: targetSessionId },
        text: "please check",
      },
      targetSessionId,
      text: "please check",
      type: "forward",
    });
    const t3Id = "t3_9c708e22-807e-4579-807a-b56d8e4341e1";
    await expect(
      build({ author: "user", text: `say-to-me(${t3Id}) check T3` }),
    ).resolves.toMatchObject({
      leadingRelay: { session: { id: t3Id }, text: "check T3" },
      targetSessionId: t3Id,
      text: "check T3",
      type: "forward",
    });
    await expect(
      build({ author: "agent", text: `say-to-me(${targetSessionId}) internal note` }),
    ).resolves.toMatchObject({
      text: `say-to-me(${targetSessionId}) internal note`,
      type: "direct",
    });
  });

  it("rejects missing and invalid authors", async () => {
    await expect(fail({ text: "hello" })).resolves.toEqual({
      error: 'Message author is required. Set author to "agent" or "user".',
      status: 400,
    });
    await expect(fail({ author: "assistant", text: "hello" })).resolves.toEqual({
      error: 'Message author must be "agent" or "user".',
      status: 400,
    });
  });

  it("rejects invalid targets and self-forwarding", async () => {
    await expect(fail({ author: "user", targetSessionId: "bad", text: "hello" })).resolves.toEqual({
      error: "Invalid target session id.",
      status: 400,
    });
    await expect(
      fail({ author: "user", targetSessionId: sourceSessionId, text: "hello" }),
    ).resolves.toEqual({ error: "Cannot forward a message to the same session.", status: 400 });
  });

  it("rejects forwarding to voice-only sessions (direct messages still allowed)", async () => {
    await expect(
      fail({ author: "user", targetSessionId: voiceSessionId, text: "relay to voice" }),
    ).resolves.toEqual({
      error: "Invalid target session id.",
      status: 400,
    });
    await expect(
      fail({
        author: "user",
        text: `say-to-me(${voiceSessionId}) please check this`,
      }),
    ).resolves.toEqual({
      error: "Invalid target session id.",
      status: 400,
    });
    // Session cards with vo_ are also rejected — voice is not an agent-backed ref.
    await expect(
      fail({
        author: "user",
        sessions: [{ id: voiceSessionId, alias: "Notes" }],
        text: "see this card",
      }),
    ).resolves.toEqual({
      error: "Sessions must be valid session ids.",
      status: 400,
    });
  });

  it("validates links, sessions, images, markdown, and notify-on-completion shapes", async () => {
    await expect(fail({ author: "user", links: "nope", text: "hello" })).resolves.toEqual({
      error: "Links must be an array of strings.",
      status: 400,
    });
    await expect(fail({ author: "user", sessions: "nope", text: "hello" })).resolves.toEqual({
      error: "Sessions must be an array of session ids or objects.",
      status: 400,
    });
    await expect(fail({ author: "user", sessions: ["bad"], text: "hello" })).resolves.toEqual({
      error: "Sessions must be valid session ids.",
      status: 400,
    });
    await expect(fail({ author: "user", extraMarkdown: 1, text: "hello" })).resolves.toEqual({
      error: "Extra markdown must be a string.",
      status: 400,
    });
    await expect(
      fail({ author: "agent", pushNotificationText: 1, text: "hello" }),
    ).resolves.toEqual({
      error: "Push notification text must be a string.",
      status: 400,
    });
    await expect(
      fail({ author: "user", pushNotificationText: "ping", text: "hello" }),
    ).resolves.toEqual({
      error: "Push notification text is only allowed on agent messages.",
      status: 400,
    });
    await expect(
      build({ author: "agent", pushNotificationText: "Build finished", text: "hello" }),
    ).resolves.toMatchObject({
      author: "agent",
      pushNotificationText: "Build finished",
      type: "direct",
    });
    await expect(fail({ author: "user", images: "nope", text: "hello" })).resolves.toEqual({
      error: "Images must be an array of file paths.",
      status: 400,
    });
    await expect(
      fail({ author: "user", images: ["/tmp/shot.png"], targetSessionId, text: "hello" }),
    ).resolves.toEqual({ error: "Forwarded messages do not support images yet.", status: 400 });
    await expect(
      fail({ author: "user", notifyOnCompletion: "yes", text: "hello" }),
    ).resolves.toEqual({ error: "Notify on completion must be a boolean.", status: 400 });
  });

  it("validates text and agent-only guardrails", async () => {
    await expect(fail({ author: "user", text: "" })).resolves.toEqual({
      error: "Message is too short. Minimum length is 1 character.",
      status: 400,
    });
    await expect(build({ author: "user", text: "x".repeat(4_001) })).resolves.toMatchObject({
      author: "user",
      text: "x".repeat(4_001),
      type: "direct",
    });
    await expect(fail({ author: "user", text: "x".repeat(32_001) })).resolves.toEqual({
      error: "Message is too long. Maximum length is 32000 characters.",
      status: 400,
    });
    await expect(fail({ author: "agent", text: "x".repeat(4_001) })).resolves.toEqual({
      error: "Message is too long. Maximum length is 4000 characters.",
      status: 400,
    });
    await expect(
      fail({ author: "user", extraMarkdown: "x".repeat(4_001), text: "hello" }),
    ).resolves.toEqual({
      error: "Message is too long. Maximum length is 4000 characters.",
      status: 400,
    });
    await expect(fail({ author: "agent", text: "look https://example.test" })).resolves.toEqual({
      error:
        "Message text contains a link. Use the links field instead. Run `say-to-me usage` for supported fields.",
      status: 400,
    });
    await expect(fail({ author: "agent", text: `raw ${targetSessionId}` })).resolves.toEqual({
      error:
        "Message text contains a raw session id. Use the sessions field instead. Run `say-to-me usage` for supported fields.",
      status: 400,
    });
    await expect(
      fail({ author: "agent", text: "commit d3152bae093ae41291ee91e80b1357b4849c75d3" }),
    ).resolves.toEqual({
      error:
        "Message text contains a full git SHA. Use the links field or extraMarkdown instead. Run `say-to-me usage` for supported fields.",
      status: 400,
    });
    await expect(
      fail({
        author: "agent",
        text: "Issue three oh two references pull request two ninety nine.",
      }),
    ).resolves.toEqual({
      error: SPELLED_NUMBER_WORDS_ERROR,
      status: 400,
    });
  });
});
