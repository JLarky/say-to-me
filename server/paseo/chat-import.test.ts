import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createMessageResult } from "../create-message.ts";
import { deleteSession, deleteSessionMessages, ensureSession } from "../sessions.ts";
import { listMessages, setMessagePinned } from "../messages.ts";

const sessionId = "pc_33333333-3333-4333-8333-333333333333";

describe("Paseo chat inbound message persistence", () => {
  const originalLimit = process.env.SAY_TO_ME_MAX_TOTAL_MESSAGES;
  beforeEach(() => {
    process.env.SAY_TO_ME_MAX_TOTAL_MESSAGES = "50";
  });
  afterEach(() => {
    deleteSessionMessages(sessionId);
    deleteSession(sessionId);
    if (originalLimit === undefined) delete process.env.SAY_TO_ME_MAX_TOTAL_MESSAGES;
    else process.env.SAY_TO_ME_MAX_TOTAL_MESSAGES = originalLimit;
  });

  async function importMessage(id: string, text: string) {
    return createMessageResult({
      sessionId,
      text,
      author: "agent",
      links: null,
      sessionRefs: null,
      clientMessageId: id,
      agentMessageStatus: "received",
      notifyAgent: false,
      extractInlineImages: false,
    });
  }

  it("persists without SSE subscribers and deduplicates Paseo ids", async () => {
    ensureSession(sessionId);
    await importMessage("paseo-1", "from paseo");
    await importMessage("paseo-1", "from paseo duplicate");

    expect(listMessages(sessionId).map((message) => message.text)).toEqual(["from paseo"]);
  });

  it("keeps the configured non-pinned window and preserves pinned rows", async () => {
    ensureSession(sessionId);
    const first = await importMessage("paseo-1", "pinned backlog row");
    const firstBody = first.body as { message: { id: number } };
    setMessagePinned(firstBody.message.id, true);
    for (let index = 2; index <= 101; index++) {
      await importMessage("paseo-" + index, "backlog row " + index);
    }

    const messages = listMessages(sessionId);
    expect(messages).toHaveLength(51);
    expect(messages.some((message) => message.text === "pinned backlog row")).toBe(true);
    expect(messages.some((message) => message.text === "backlog row 2")).toBe(false);
    expect(messages.at(-1)?.text).toBe("backlog row 101");
  });
});
