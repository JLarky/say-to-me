import { describe, expect, it } from "vite-plus/test";
import { classifyCliTimeoutFromActivity } from "./opencode/timeout-classification.ts";

describe("OpenCode CLI timeout classification", () => {
  it.each(["busy", "pending", "retrying"])(
    "treats %s activity after delivery start as pending confirmation",
    (status) => {
      expect(
        classifyCliTimeoutFromActivity(
          { latestActivityAt: 1500, latestActivitySnapshot: { status } },
          1000,
        ),
      ).toBe("pending");
    },
  );

  it("keeps CLI timeout when there is no activity signal", () => {
    expect(classifyCliTimeoutFromActivity(null, 1000)).toBe("cli_timed_out");
  });

  it("treats current pending status as pending confirmation", () => {
    expect(classifyCliTimeoutFromActivity(null, 1000, "pending")).toBe("pending");
  });

  it("keeps CLI timeout when activity predates the delivery", () => {
    expect(
      classifyCliTimeoutFromActivity(
        { latestActivityAt: 999, latestActivitySnapshot: { status: "busy" } },
        1000,
      ),
    ).toBe("cli_timed_out");
  });

  it("keeps CLI timeout when latest activity is idle", () => {
    expect(
      classifyCliTimeoutFromActivity(
        { latestActivityAt: 1500, latestActivitySnapshot: { status: "idle" } },
        1000,
      ),
    ).toBe("cli_timed_out");
  });
});
