import { describe, expect, it } from "vite-plus/test";
import {
  formatRemaining,
  repeatLabel,
  routineCountdownLabel,
  type RoutineLabelInput,
} from "./routine-labels.ts";

describe("routine labels", () => {
  function routine(overrides: Partial<RoutineLabelInput>): RoutineLabelInput {
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

  it("describes active routine countdowns and terminal states", () => {
    expect(routineCountdownLabel(routine({ nextFireAt: 1_300_000 }), 1_000_000)).toBe(
      "will fire in 5m",
    );
    expect(routineCountdownLabel(routine({ nextFireAt: 999_000 }), 1_000_000)).toBe("due now");
    expect(routineCountdownLabel(routine({ status: "firing" }), 1_000_000)).toBe("firing now");
    expect(routineCountdownLabel(routine({ status: "fired" }), 1_000_000)).toBe("fired");
    expect(
      routineCountdownLabel(routine({ status: "paused", nextFireAt: 999_000 }), 1_000_000),
    ).toBe("stopped");
  });

  it("labels repeat intervals", () => {
    expect(repeatLabel(routine({ intervalMs: null }))).toBe("One-shot");
    expect(repeatLabel(routine({ intervalMs: 15 * 60_000 }))).toBe("Every 15m");
    expect(repeatLabel(routine({ intervalMs: 2 * 60 * 60_000 }))).toBe("Every 2h");
  });
});
