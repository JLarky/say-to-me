import { describe, expect, it } from "vite-plus/test";
import { grokDeliveryPrompt } from "./rest-delivery-worker.ts";

describe("Grok REST delivery prompt", () => {
  it("includes the isolated CLI origin", () => {
    const previous = process.env.SAY_TO_ME_URL;
    process.env.SAY_TO_ME_URL = "http://127.0.0.1:5412";
    try {
      expect(grokDeliveryPrompt({ grokSessionId: "gr_abc" }, { text: "hello" })).toContain(
        "say-to-me api --server http://127.0.0.1:5412",
      );
    } finally {
      if (previous === undefined) delete process.env.SAY_TO_ME_URL;
      else process.env.SAY_TO_ME_URL = previous;
    }
  });
});
