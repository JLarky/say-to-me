import { describe, expect, it } from "vite-plus/test";
import { isOpenCodeSessionId } from "./session-id.ts";
import { testOpenCodeSessionId } from "./test-opencode-id.ts";

describe("testOpenCodeSessionId", () => {
  it("emits deterministic production-shaped OpenCode ids", () => {
    const a = testOpenCodeSessionId("queueCap");
    const b = testOpenCodeSessionId("queueCap");
    expect(a).toBe(b);
    expect(isOpenCodeSessionId(a)).toBe(true);
    expect(a).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });

  it("differs by label", () => {
    expect(testOpenCodeSessionId("alpha")).not.toBe(testOpenCodeSessionId("beta"));
  });
});
