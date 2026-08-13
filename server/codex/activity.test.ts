import { describe, expect, it } from "vite-plus/test";
import { parseCodexActivity } from "./activity.ts";

const line = (obj: unknown) => JSON.stringify(obj);

const sample = [
  line({
    timestamp: "2026-07-01T00:00:00.000Z",
    type: "event_msg",
    payload: { type: "agent_message", message: "Checking docs first.", phase: "commentary" },
  }),
  line({
    timestamp: "2026-07-01T00:00:01.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Two plus two equals **four**." }],
    },
  }),
  line({
    timestamp: "2026-07-01T00:00:02.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "date", workdir: "/tmp/repo" }),
    },
  }),
  line({
    timestamp: "2026-07-01T00:00:03.000Z",
    type: "response_item",
    payload: {
      type: "web_search_call",
      action: { type: "search", query: "codex data controls" },
    },
  }),
  "",
  "{ not json",
].join("\n");

describe("parseCodexActivity", () => {
  it("extracts commentary, assistant text, and tool calls in order", () => {
    const { items, lastTimestamp } = parseCodexActivity(sample, 10);
    expect(items).toEqual([
      {
        kind: "thinking",
        text: "Checking docs first.",
        timestamp: Date.parse("2026-07-01T00:00:00.000Z"),
      },
      {
        kind: "message",
        text: "Two plus two equals **four**.",
        timestamp: Date.parse("2026-07-01T00:00:01.000Z"),
      },
      {
        kind: "tool",
        tool: "exec_command",
        text: "exec_command date",
        timestamp: Date.parse("2026-07-01T00:00:02.000Z"),
      },
      {
        kind: "tool",
        tool: "web_search",
        text: "web_search codex data controls",
        timestamp: Date.parse("2026-07-01T00:00:03.000Z"),
      },
    ]);
    expect(lastTimestamp).toBe(Date.parse("2026-07-01T00:00:03.000Z"));
  });

  it("keeps only the last limit items", () => {
    const { items } = parseCodexActivity(sample, 2);
    expect(items).toHaveLength(2);
    expect(items[0].tool).toBe("exec_command");
    expect(items[1].tool).toBe("web_search");
  });

  it("returns empty for a blank transcript", () => {
    expect(parseCodexActivity("", 5)).toEqual({ items: [], lastTimestamp: null });
  });
});
