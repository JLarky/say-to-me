import { describe, expect, it } from "vite-plus/test";
import { createHeardSpecterApp } from "./heard.ts";

describe("heard Specter slice", () => {
  it("records a receipt through the command and returns it from the query", async () => {
    const app = createHeardSpecterApp();

    await app.recordHeard({ sessionId: "voice-alpha", messageId: "42" });
    const listed = await app.heardQuery({ sessionId: "voice-alpha" });

    expect(listed.receipts).toHaveLength(1);
    expect(listed.receipts[0]?.messageId).toBe("42");
    expect(listed.receipts[0]?.heardAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not duplicate an already-heard message id", async () => {
    const app = createHeardSpecterApp();

    await app.recordHeard({ sessionId: "voice-alpha", messageId: "42" });
    await app.recordHeard({ sessionId: "voice-alpha", messageId: "42" });

    expect(await app.heardQuery({ sessionId: "voice-alpha" })).toEqual({
      receipts: [expect.objectContaining({ messageId: "42" })],
    });
  });

  it("isolates receipts by session", async () => {
    const app = createHeardSpecterApp();

    await app.recordHeard({ sessionId: "voice-alpha", messageId: "1" });
    await app.recordHeard({ sessionId: "voice-beta", messageId: "2" });

    expect(await app.heardQuery({ sessionId: "voice-alpha" })).toEqual({
      receipts: [expect.objectContaining({ messageId: "1" })],
    });
    expect(await app.heardQuery({ sessionId: "voice-beta" })).toEqual({
      receipts: [expect.objectContaining({ messageId: "2" })],
    });
  });
});
