import { describe, expect, it } from "vite-plus/test";
import { normalizeOpenCodeSseActivity } from "./opencode/activity.ts";

describe("normalizeOpenCodeSseActivity", () => {
  it("surfaces thinking SSE part updates", () => {
    const result = normalizeOpenCodeSseActivity("ses_215021e966f99ByffdkaDjJ2Ad", {
      id: "evt_reasoning",
      type: "message.part.updated",
      properties: {
        sessionID: "ses_215021e966f99ByffdkaDjJ2Ad",
        time: 12_000,
        part: {
          id: "prt_reasoning",
          messageID: "msg_reasoning",
          type: "reasoning",
          text: "checking logs",
        },
      },
    });

    expect(result).toMatchObject({
      latestOutputSnippet: "Thinking: checking logs",
      recentItems: [
        expect.objectContaining({ kind: "thinking", snippet: "Thinking: checking logs" }),
      ],
      previewSource: "sse",
      identifiers: {
        eventId: "evt_reasoning",
        messageId: "msg_reasoning",
        partId: "prt_reasoning",
      },
    });
  });

  it("surfaces compaction SSE events", () => {
    const result = normalizeOpenCodeSseActivity("ses_129b0eb61a4dmUzIjzocuOle4x", {
      id: "evt_compact",
      type: "session.compacted",
      properties: { sessionID: "ses_129b0eb61a4dmUzIjzocuOle4x", time: 12_000 },
    });

    expect(result).toMatchObject({
      latestOutputSnippet: "Compacted conversation context.",
      recentItems: [
        expect.objectContaining({ kind: "compaction", snippet: "Compacted conversation context." }),
      ],
      eventType: "session.compacted",
      identifiers: { eventId: "evt_compact" },
    });
  });
});
