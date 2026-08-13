import { describe, expect, it } from "vite-plus/test";
import { parseGrokActivity } from "./activity.ts";

const line = (obj: unknown) => JSON.stringify(obj);

const sample = [
  line({
    timestamp: "2026-07-01T00:00:00.000Z",
    type: "reasoning",
    summary: [{ type: "summary_text", text: "Let me think about this." }],
  }),
  line({
    timestamp: "2026-07-01T00:00:01.000Z",
    type: "assistant",
    content: "The answer is 42.",
  }),
  line({
    timestamp: "2026-07-01T00:00:02.000Z",
    role: "assistant",
    content: "",
    tool_calls: [{ name: "bash", arguments: '{"cmd":"ls"}' }],
  }),
  line({
    timestamp: "2026-07-01T00:00:03.000Z",
    type: "assistant",
    content: [
      { type: "tool_use", name: "read_file", input: '{"path":"foo.ts"}' },
      { type: "text", text: "Looking at the file." },
      { type: "thinking", thinking: "I should check imports." },
    ],
  }),
  "",
  "{ not json",
].join("\n");

describe("parseGrokActivity", () => {
  it("extracts reasoning, assistant text, and tool calls in order", () => {
    const { items, lastTimestamp } = parseGrokActivity(sample, 10);
    expect(items).toEqual([
      {
        kind: "thinking",
        text: "Let me think about this.",
        timestamp: Date.parse("2026-07-01T00:00:00.000Z"),
      },
      {
        kind: "message",
        text: "The answer is 42.",
        timestamp: Date.parse("2026-07-01T00:00:01.000Z"),
      },
      {
        kind: "tool",
        tool: "bash",
        text: "bash ls",
        timestamp: Date.parse("2026-07-01T00:00:02.000Z"),
      },
      {
        kind: "tool",
        tool: "read_file",
        text: "read_file foo.ts",
        timestamp: Date.parse("2026-07-01T00:00:03.000Z"),
      },
      {
        kind: "message",
        text: "Looking at the file.",
        timestamp: Date.parse("2026-07-01T00:00:03.000Z"),
      },
      {
        kind: "thinking",
        text: "I should check imports.",
        timestamp: Date.parse("2026-07-01T00:00:03.000Z"),
      },
    ]);
    expect(lastTimestamp).toBe(Date.parse("2026-07-01T00:00:03.000Z"));
  });

  it("keeps only the last limit items", () => {
    const { items } = parseGrokActivity(sample, 2);
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("message");
    expect(items[0].text).toBe("Looking at the file.");
    expect(items[1].kind).toBe("thinking");
    expect(items[1].text).toBe("I should check imports.");
  });

  it("returns empty for a blank transcript", () => {
    expect(parseGrokActivity("", 5)).toEqual({ items: [], lastTimestamp: null });
  });

  it("falls back to content-as-string for simple formats", () => {
    const simple = [
      line({ timestamp: "2026-07-01T00:00:00.000Z", type: "assistant", content: "Hi there." }),
    ].join("\n");
    const { items } = parseGrokActivity(simple, 5);
    expect(items).toEqual([
      { kind: "message", text: "Hi there.", timestamp: Date.parse("2026-07-01T00:00:00.000Z") },
    ]);
  });
});
