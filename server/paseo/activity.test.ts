import { describe, expect, it } from "vitest";
import { parsePaseoActivity } from "./activity.ts";

describe("parsePaseoActivity", () => {
  it("maps curated Paseo log entries into activity items", () => {
    expect(parsePaseoActivity("[Thought] First\n[SomeTool] did work\n[User] hello", 10)).toEqual({
      items: [
        { kind: "thinking", text: "First", timestamp: null },
        { kind: "tool", tool: "SomeTool", text: "did work", timestamp: null },
        { kind: "message", text: "[User] hello", timestamp: null },
      ],
      lastTimestamp: null,
    });
  });

  it("handles empty Paseo output", () => {
    expect(parsePaseoActivity("No activity to display.", 10)).toEqual({
      items: [],
      lastTimestamp: null,
    });
  });
});
