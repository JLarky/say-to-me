import { describe, expect, it } from "vite-plus/test";
import { buildClaudeUserText } from "./create-message.ts";

describe("buildClaudeUserText", () => {
  it("includes markdown and attachment paths for Claude prompts", () => {
    expect(buildClaudeUserText("hello", "details", ["/tmp/a.png", "/tmp/b.md"])).toBe(
      "hello\n\ndetails\n\n/tmp/a.png\n/tmp/b.md",
    );
  });
});
