import { describe, expect, it } from "vite-plus/test";
import { analyzeLegacyMessageSurface } from "./opencode/activity.ts";

describe("analyzeLegacyMessageSurface", () => {
  type LegacyPart =
    | { id: string; type: "text"; text: string }
    | { id: string; type: "step-start" }
    | { id: string; type: "reasoning"; text?: string }
    | { id: string; type: "summary"; text?: string }
    | {
        id: string;
        type: "tool";
        state?: { output?: string; error?: string };
      };

  function assistantMessage(
    id: string,
    parts: LegacyPart[],
    time: { created?: number; completed?: number } = { created: 1000, completed: 1100 },
  ) {
    return { info: { id, role: "assistant", time }, parts };
  }

  function userMessage(id: string, text: string) {
    return {
      info: { id, role: "user", time: { created: 1 } },
      parts: [{ id: `${id}-p`, type: "text", text }],
    };
  }

  function compactionMessage(id: string, text: string) {
    return {
      info: {
        agent: "compaction",
        id,
        mode: "compaction",
        role: "assistant",
        summary: true,
        time: { created: 2000, completed: 2100 },
      },
      parts: [{ id: `${id}-p`, type: "text", text }],
    };
  }

  it("prefers assistant text over tool output in the same message", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [
        { id: "prt_tool", type: "tool", state: { output: "tool produced this output" } },
        { id: "prt_text", type: "text", text: "Here is the human readable answer." },
      ]),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBe("Here is the human readable answer.");
    expect(result.identifiers).toMatchObject({ messageId: "msg_1", partId: "prt_text" });
    expect(result.exposesToolOutput).toBe(true);
  });

  it("prefers assistant text even when tool output appears later", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [
        { id: "prt_text", type: "text", text: "Assistant reply first." },
        { id: "prt_tool", type: "tool", state: { output: "later tool output" } },
      ]),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBe("Assistant reply first.");
    expect(result.identifiers.partId).toBe("prt_text");
  });

  it("combines multiple assistant text parts from the same message", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [
        { id: "prt_first", type: "text", text: "Preface." },
        { id: "prt_second", type: "text", text: "Actual answer." },
      ]),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBe("Preface.\n\nActual answer.");
    expect(result.identifiers).toMatchObject({ messageId: "msg_1", partId: "prt_first" });
    expect(result.recentItems[0]).toMatchObject({
      messageId: "msg_1",
      partId: "prt_first",
      snippet: "Preface.\n\nActual answer.",
    });
  });

  it("falls back to useful tool output when no assistant text exists", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [
        { id: "prt_tool", type: "tool", state: { output: "All 12 tests passed." } },
      ]),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBe("All 12 tests passed.");
    expect(result.identifiers).toMatchObject({ messageId: "msg_1", partId: "prt_tool" });
  });

  it("uses tool error text as fallback when no assistant text or output exists", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [
        { id: "prt_tool", type: "tool", state: { error: "Command failed: exit code 2" } },
      ]),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBe("Command failed: exit code 2");
    expect(result.identifiers.partId).toBe("prt_tool");
  });

  it.each([
    ["curl progress totals", "% Total    % Received % Xferd  Average Speed"],
    ["curl Dload header", "Dload  Upload   Total   Spent    Left  Speed\n100  1234"],
    ["apply_patch success", "Success. Updated the following files:\nserver/api.ts"],
    ["grep/find output", "Found 4 matches in 2 files"],
    ["file path payload", "<path>server/api.ts</path>"],
    ["git diff", "diff --git a/server/api.ts b/server/api.ts"],
    ["Say To Me message JSON", '{"message":{"id":42,"text":"hi"}}'],
    ["Say To Me delivery JSON", '{"opencodeDeliveryStatus":"speaking"}'],
  ])("does not surface noisy %s tool output as the snippet", (_name, output) => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [{ id: "prt_tool", type: "tool", state: { output } }]),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBeNull();
    expect(result.identifiers.partId).toBeNull();
    expect(result.exposesToolOutput).toBe(true);
  });

  it("keeps assistant text and ignores noisy tool output around it", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [
        { id: "prt_curl", type: "tool", state: { output: "% Total    % Received" } },
        { id: "prt_text", type: "text", text: "Done. The build is green." },
        { id: "prt_diff", type: "tool", state: { output: "diff --git a/x b/x" } },
      ]),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBe("Done. The build is green.");
    expect(result.identifiers.partId).toBe("prt_text");
  });

  it("reports partId of the exact text part, not an earlier step-start part", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [
        { id: "prt_step", type: "step-start" },
        { id: "prt_text", type: "text", text: "Final answer." },
      ]),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBe("Final answer.");
    expect(result.identifiers.partId).toBe("prt_text");
  });

  it("picks the newest assistant message and ignores user messages", () => {
    const result = analyzeLegacyMessageSurface([
      userMessage("msg_user", "what is the status?"),
      assistantMessage("msg_old", [{ id: "prt_old", type: "text", text: "Older reply." }], {
        created: 1000,
        completed: 1100,
      }),
      assistantMessage("msg_new", [{ id: "prt_new", type: "text", text: "Newest reply." }], {
        created: 5000,
        completed: 5100,
      }),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBe("Newest reply.");
    expect(result.identifiers).toMatchObject({ messageId: "msg_new", partId: "prt_new" });
  });

  it("returns up to five recent assistant activity items", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [{ id: "prt_1", type: "text", text: "First" }], {
        created: 1000,
        completed: 1100,
      }),
      assistantMessage("msg_2", [{ id: "prt_2", type: "tool", state: { output: "Tool output" } }], {
        created: 2000,
        completed: 2100,
      }),
      assistantMessage("msg_3", [{ id: "prt_3", type: "reasoning", text: "Thinking" }], {
        created: 3000,
        completed: 3100,
      }),
      assistantMessage("msg_4", [{ id: "prt_4", type: "summary", text: "Compacted" }], {
        created: 4000,
        completed: 4100,
      }),
      assistantMessage("msg_5", [{ id: "prt_5", type: "text", text: "Fifth" }], {
        created: 5000,
        completed: 5100,
      }),
      assistantMessage("msg_6", [{ id: "prt_6", type: "text", text: "Newest" }], {
        created: 6000,
        completed: 6100,
      }),
    ]);

    expect(result.recentItems).toHaveLength(5);
    expect(result.recentItems.map((item) => item.messageId)).toEqual([
      "msg_6",
      "msg_5",
      "msg_4",
      "msg_3",
      "msg_2",
    ]);
    expect(result.recentItems.map((item) => item.kind)).toEqual([
      "message",
      "message",
      "compaction",
      "thinking",
      "tool",
    ]);
  });

  it("marks OpenCode compaction assistant summaries as compaction activity", () => {
    const result = analyzeLegacyMessageSurface([
      {
        info: { id: "msg_user_compact", role: "user", time: { created: 1900 } },
        parts: [{ id: "prt_user_compact", type: "compaction", auto: false }],
      },
      compactionMessage("msg_compaction", "Updated handoff summary."),
    ]);

    expect(result.recentItems[0]).toMatchObject({
      kind: "compaction",
      messageId: "msg_compaction",
      partId: "msg_compaction-p",
      snippet: "Compacted context: Updated handoff summary.",
    });
    expect(result.humanReadableLatestAssistantSnippet).toBe("Updated handoff summary.");
  });

  it("marks partial live updates while the assistant message is still generating", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [{ id: "prt_text", type: "text", text: "Working on it" }], {
        created: 5000,
      }),
    ]);

    expect(result.partialLiveUpdates).toBe(true);
  });

  it("surfaces thinking parts when no assistant text is available", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [
        { id: "prt_reasoning", type: "reasoning", text: "checking logs" },
      ]),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBe("Thinking: checking logs");
    expect(result.identifiers).toMatchObject({ messageId: "msg_1", partId: "prt_reasoning" });
  });

  it("surfaces compaction parts when no assistant text is available", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_1", [{ id: "prt_summary", type: "summary", text: "kept test plan" }]),
    ]);

    expect(result.humanReadableLatestAssistantSnippet).toBe("Compacted context: kept test plan");
    expect(result.identifiers).toMatchObject({ messageId: "msg_1", partId: "prt_summary" });
  });

  it("returns an empty surface for non-array input", () => {
    const result = analyzeLegacyMessageSurface(null);

    expect(result.messageCount).toBe(0);
    expect(result.humanReadableLatestAssistantSnippet).toBeNull();
    expect(result.identifiers.partId).toBeNull();
  });

  it("surfaces assistant message info.error ahead of older successful output", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage(
        "msg_ok",
        [{ id: "prt_ok", type: "text", text: "Saved task to tasks.md." }],
        {
          created: 1000,
          completed: 1100,
        },
      ),
      {
        info: {
          id: "msg_failed",
          role: "assistant",
          time: { created: 2000, completed: 2100 },
          error: {
            name: "UnknownError",
            data: { message: "AWS credential provider failed: Token is expired." },
          },
        },
        parts: [],
      },
    ]);

    expect(result.latestMessageError).toBe("AWS credential provider failed: Token is expired.");
    expect(result.humanReadableLatestAssistantSnippet).toBe(
      "AWS credential provider failed: Token is expired.",
    );
    expect(result.recentItems[0]?.snippet).toBe(
      "AWS credential provider failed: Token is expired.",
    );
  });

  it("prefers newest successful output over older assistant errors", () => {
    const result = analyzeLegacyMessageSurface([
      assistantMessage("msg_ok", [{ id: "prt_ok", type: "text", text: "Latest success reply." }], {
        created: 3000,
        completed: 3100,
      }),
      {
        info: {
          id: "msg_failed",
          role: "assistant",
          time: { created: 2000, completed: 2100 },
          error: {
            name: "UnknownError",
            data: { message: "Stale AWS credential error." },
          },
        },
        parts: [],
      },
    ]);

    expect(result.latestMessageError).toBeNull();
    expect(result.humanReadableLatestAssistantSnippet).toBe("Latest success reply.");
    expect(result.recentItems[0]?.snippet).toBe("Latest success reply.");
  });
});
