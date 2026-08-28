import { describe, expect, it } from "vite-plus/test";
import { grokDeliveryPrompt } from "./rest-delivery-worker.ts";

describe("Grok REST delivery prompt", () => {
  it("includes the isolated CLI origin", () => {
    expect(
      grokDeliveryPrompt(
        { grokSessionId: "gr_abc" },
        { text: "hello" },
        {
          env: { SAY_TO_ME_URL: "http://127.0.0.1:5412" },
          existsSync: () => false,
          readFileSync: () => "",
        },
      ),
    ).toContain("say-to-me api --server http://127.0.0.1:5412");
  });
});
