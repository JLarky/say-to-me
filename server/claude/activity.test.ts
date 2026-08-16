import { describe, expect, it } from "vite-plus/test";
import { parseClaudeActivity } from "./activity.ts";

const line = <T>(obj: T) => JSON.stringify(obj);

const sample = [
  line({ type: "user", timestamp: "2026-07-01T00:00:00.000Z", message: { content: "hi" } }),
  line({
    type: "assistant",
    timestamp: "2026-07-01T00:00:01.000Z",
    message: { content: [{ type: "text", text: "Hello **there**\n" }] },
  }),
  line({
    type: "assistant",
    timestamp: "2026-07-01T00:00:02.000Z",
    message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "/tmp/x.ts" } }] },
  }),
  "",
  "{ not json",
].join("\n");

describe("parseClaudeActivity", () => {
  it("extracts assistant text and tool_use items in order, ignoring user/garbage lines", () => {
    const { items, lastTimestamp } = parseClaudeActivity(sample, 10);
    expect(items).toEqual([
      {
        kind: "message",
        text: "Hello **there**",
        timestamp: Date.parse("2026-07-01T00:00:01.000Z"),
      },
      {
        kind: "tool",
        tool: "Write",
        text: "Write /tmp/x.ts",
        timestamp: Date.parse("2026-07-01T00:00:02.000Z"),
      },
    ]);
    expect(lastTimestamp).toBe(Date.parse("2026-07-01T00:00:02.000Z"));
  });

  it("keeps only the last `limit` items", () => {
    const { items } = parseClaudeActivity(sample, 1);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("tool");
  });

  it("returns empty for a blank transcript", () => {
    expect(parseClaudeActivity("", 5)).toEqual({ items: [], lastTimestamp: null });
  });
});
