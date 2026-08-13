import { describe, expect, it } from "vite-plus/test";
import { parseCursorActivity } from "./activity.ts";

const line = (obj: unknown) => JSON.stringify(obj);

const sample = [
  line({ role: "user", message: { content: [{ type: "text", text: "hi" }] } }),
  line({
    role: "assistant",
    message: { content: [{ type: "text", text: "Hello **there**\n" }] },
  }),
  line({ type: "turn_ended", status: "success" }),
  "",
  "{ not json",
].join("\n");

describe("parseCursorActivity", () => {
  it("extracts assistant text items and ignores user/garbage lines", () => {
    const { items, lastTimestamp } = parseCursorActivity(sample, 10);
    expect(items).toEqual([{ kind: "message", text: "Hello **there**", timestamp: null }]);
    expect(lastTimestamp).toBe(null);
  });

  it("keeps only the last `limit` items", () => {
    const many = [
      line({ role: "assistant", message: { content: [{ type: "text", text: "one" }] } }),
      line({ role: "assistant", message: { content: [{ type: "text", text: "two" }] } }),
    ].join("\n");
    const { items } = parseCursorActivity(many, 1);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("two");
  });

  it("returns empty for a blank transcript", () => {
    expect(parseCursorActivity("", 5)).toEqual({ items: [], lastTimestamp: null });
  });

  it("expands CreatePlan tool input into markdown activity text", () => {
    const transcript = line({
      role: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "CreatePlan",
            input: {
              name: "Jarvis location settings",
              overview: "Add a preferred Jarvis parent path.",
              plan: "# Steps\n\n1. Add settings column",
              todos: [{ id: "db", content: "Add DB column" }],
            },
          },
        ],
      },
    });
    const { items } = parseCursorActivity(transcript, 5);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("tool");
    expect(items[0]?.tool).toBe("CreatePlan");
    expect(items[0]?.text).toContain("**CreatePlan:** Jarvis location settings");
    expect(items[0]?.text).toContain("# Steps");
    expect(items[0]?.text).toContain("- [ ] Add DB column");
  });
});
