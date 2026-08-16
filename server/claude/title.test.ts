import { describe, expect, it } from "vite-plus/test";
import { parseAiTitle } from "./title.ts";

const line = <T>(obj: T) => JSON.stringify(obj);

describe("parseAiTitle", () => {
  it("returns the aiTitle from an ai-title entry", () => {
    const jsonl = [
      line({ type: "user", message: { content: "hi" } }),
      line({ type: "ai-title", aiTitle: "Review pull request 345" }),
    ].join("\n");
    expect(parseAiTitle(jsonl)).toBe("Review pull request 345");
  });

  it("takes the last aiTitle when it was rewritten", () => {
    const jsonl = [
      line({ type: "ai-title", aiTitle: "First guess" }),
      line({ type: "ai-title", aiTitle: "Better title" }),
    ].join("\n");
    expect(parseAiTitle(jsonl)).toBe("Better title");
  });

  it("returns null when there is no title, ignoring garbage lines", () => {
    const jsonl = [line({ type: "assistant", message: { content: [] } }), "", "{ not json"].join(
      "\n",
    );
    expect(parseAiTitle(jsonl)).toBe(null);
  });
});
