import { describe, expect, it } from "vite-plus/test";
import {
  formatRemaining,
  repeatLabel,
  timerCountdownLabel,
  type JarvisTimerLabelInput,
} from "./jarvis-timer-labels.ts";

describe("jarvis timer labels", () => {
  function timer(overrides: Partial<JarvisTimerLabelInput>): JarvisTimerLabelInput {
    return {
      status: "active",
      nextFireAt: 1_000_000,
      intervalMs: null,
      lastError: null,
      ...overrides,
    };
  }

  it("formats remaining durations", () => {
    expect(formatRemaining(1_000)).toBe("1s");
    expect(formatRemaining(300_000)).toBe("5m");
    expect(formatRemaining(3_600_000)).toBe("1h");
    expect(formatRemaining(3_900_000)).toBe("1h 5m");
  });

  it("describes active timer countdowns and terminal states", () => {
    expect(timerCountdownLabel(timer({ nextFireAt: 1_300_000 }), 1_000_000)).toBe(
      "will fire in 5m",
    );
    expect(timerCountdownLabel(timer({ nextFireAt: 999_000 }), 1_000_000)).toBe("due now");
    expect(timerCountdownLabel(timer({ status: "firing" }), 1_000_000)).toBe("firing now");
    expect(timerCountdownLabel(timer({ status: "completed" }), 1_000_000)).toBe("completed");
    expect(timerCountdownLabel(timer({ status: "paused", nextFireAt: 999_000 }), 1_000_000)).toBe(
      "stopped",
    );
  });

  it("labels repeat intervals", () => {
    expect(repeatLabel(timer({ intervalMs: null }))).toBe("One-shot");
    expect(repeatLabel(timer({ intervalMs: 15 * 60_000 }))).toBe("Every 15m");
    expect(repeatLabel(timer({ intervalMs: 2 * 60 * 60_000 }))).toBe("Every 2h");
  });
});
