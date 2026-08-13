import { describe, expect, it } from "vite-plus/test";

import { buildT3DispatchCommand } from "./client.ts";

describe("T3 dispatch client", () => {
  it("builds a when-idle turn with stable IDs from the local message", () => {
    expect(
      buildT3DispatchCommand({
        threadId: "11111111-1111-4111-8111-111111111111",
        messageId: 42,
        text: "Please inspect the failing test.",
        createdAt: "2026-07-28T18:00:00.000Z",
      }),
    ).toEqual({
      type: "thread.turn.start",
      commandId: "say-to-me-42",
      threadId: "11111111-1111-4111-8111-111111111111",
      message: {
        messageId: "say-to-me-42",
        role: "user",
        text: "Please inspect the failing test.",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      deliveryMode: "when-idle",
      createdAt: "2026-07-28T18:00:00.000Z",
    });
  });

  it("does not change command identity when a retry rebuilds the payload", () => {
    const input = {
      threadId: "11111111-1111-4111-8111-111111111111",
      messageId: 7,
      text: "retry me",
      createdAt: "2026-07-28T18:00:00.000Z",
    };
    const first = buildT3DispatchCommand(input);
    const retry = buildT3DispatchCommand(input);

    expect(retry.commandId).toBe(first.commandId);
    expect(retry.message.messageId).toBe(first.message.messageId);
  });
});
