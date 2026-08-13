import { describe, expect, it } from "vite-plus/test";
import { parseGrokSessionSignalsModel, parseGrokSessionSummaryModel } from "./current-model.ts";

describe("Grok per-session model", () => {
  it("parses current_model_id from summary.json", () => {
    expect(
      parseGrokSessionSummaryModel(
        JSON.stringify({
          info: { id: "019f49e0-f00d-72c2-b90d-6f9740557329" },
          current_model_id: "grok-4.5",
        }),
      ),
    ).toBe("grok-4.5");
  });

  it("parses primaryModelId from signals.json", () => {
    expect(
      parseGrokSessionSignalsModel(
        JSON.stringify({
          modelsUsed: ["grok-4.5"],
          primaryModelId: "grok-4.5",
        }),
      ),
    ).toBe("grok-4.5");
  });

  it("returns null when model fields are missing", () => {
    expect(parseGrokSessionSummaryModel("{}")).toBeNull();
    expect(parseGrokSessionSignalsModel("{}")).toBeNull();
  });
});
