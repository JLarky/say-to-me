import { describe, expect, it } from "vite-plus/test";
import { grokBootstrapCommandArgs, parseGrokStartedSessionId } from "./bootstrap.ts";

describe("Grok create-time bootstrap", () => {
  it("builds grok headless bootstrap command args", () => {
    expect(grokBootstrapCommandArgs("don't think, just reply okay", "grok-4.5")).toEqual([
      "--single",
      "don't think, just reply okay",
      "--output-format",
      "json",
      "--always-approve",
      "--model",
      "grok-4.5",
    ]);
  });

  it("parses sessionId from headless JSON output", () => {
    expect(
      parseGrokStartedSessionId(
        JSON.stringify({
          text: "okay",
          stopReason: "EndTurn",
          sessionId: "019f49db-d67f-71f2-b5c6-2f0c6fe8ce62",
        }),
      ),
    ).toBe("019f49db-d67f-71f2-b5c6-2f0c6fe8ce62");
  });

  it("parses sessionId from multi-line JSONL-ish output", () => {
    expect(
      parseGrokStartedSessionId(
        [
          '{"type":"progress"}',
          '{"text":"okay","sessionId":"019f49db-d67f-71f2-b5c6-2f0c6fe8ce62"}',
        ].join("\n"),
      ),
    ).toBe("019f49db-d67f-71f2-b5c6-2f0c6fe8ce62");
  });

  it("returns null when sessionId is missing", () => {
    expect(parseGrokStartedSessionId('{"text":"okay"}')).toBeNull();
  });
});
