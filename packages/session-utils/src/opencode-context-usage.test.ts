import { describe, expect, it } from "vite-plus/test";
import {
  formatContextUsage,
  formatContextUsageDetails,
  formatContextUsageTitle,
  formatTokenCount,
} from "./opencode-context-usage.ts";

describe("opencode context usage formatting", () => {
  it("formats token counts with K and M suffixes", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(119_119)).toBe("119.1K");
    expect(formatTokenCount(1_050_000)).toBe("1.1M");
  });

  it("formats latest-message token usage for the pill and details", () => {
    const activity = {
      contextUsage: {
        usedTokens: 119_119,
        limitTokens: 1_050_000,
        percent: 11.3,
        source: "latestMessageTokens" as const,
      },
    };

    expect(formatContextUsage(activity)).toBe("119.1K / 1.1M");
    expect(formatContextUsageDetails(activity)).toBe("11% · 119.1K / 1.1M tokens");
    expect(formatContextUsageTitle(activity)).toBe(
      "Latest OpenCode message token total compared with the model context limit.",
    );
  });

  it("returns null when context usage is missing or unsupported", () => {
    expect(formatContextUsage(null)).toBeNull();
    expect(formatContextUsage({ contextUsage: null })).toBeNull();
    expect(formatContextUsageDetails({ contextUsage: {} })).toBeNull();
    expect(formatContextUsageTitle({ contextUsage: { usedTokens: 1 } })).toBeNull();
  });
});
