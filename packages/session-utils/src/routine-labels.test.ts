import { describe, expect, it } from "vite-plus/test";
import {
  formatRemaining,
  isGeneratedSessionIdleTitle,
  repeatLabel,
  routineCountdownLabel,
  routineScheduleLabel,
  sessionIdlePartyLabel,
  sessionIdleRoutineTitle,
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

  it("uses session aliases for idle wait copy without duplicating title/schedule", () => {
    const owner = "cur_00000000-0000-4000-8000-0000000000aa";
    const target = "cur_00000000-0000-4000-8000-0000000000bb";
    const idle = routine({
      triggerKind: "session_idle",
      ownerSessionId: owner,
      targetSessionId: target,
      ownerDisplayName: "e2e source",
      targetDisplayName: "e2e target",
      title: `Wait for ${target}`,
      viewerSessionId: owner,
    });

    expect(isGeneratedSessionIdleTitle(idle.title, target)).toBe(true);
    expect(sessionIdlePartyLabel(idle)).toBe("waiting for e2e target to go idle");
    expect(sessionIdleRoutineTitle(idle)).toBe("waiting for e2e target to go idle");
    expect(routineCountdownLabel(idle)).toBe("");
    expect(routineScheduleLabel(idle)).toBe("Active wait.");

    const onTarget = { ...idle, viewerSessionId: target };
    expect(sessionIdlePartyLabel(onTarget)).toBe("will notify e2e source when idle");
    expect(sessionIdleRoutineTitle(onTarget)).toBe("will notify e2e source when idle");
  });

  it("preserves custom idle titles for owners and always notifies on the target view", () => {
    const owner = "cur_00000000-0000-4000-8000-0000000000aa";
    const target = "cur_00000000-0000-4000-8000-0000000000cc";
    expect(
      sessionIdleRoutineTitle({
        title: "Ping me when B finishes",
        ownerSessionId: owner,
        ownerDisplayName: "e2e source",
        targetSessionId: target,
        targetDisplayName: "e2e target",
        viewerSessionId: owner,
      }),
    ).toBe("Ping me when B finishes");

    expect(
      sessionIdleRoutineTitle({
        title: "Ping me when B finishes",
        ownerSessionId: owner,
        ownerDisplayName: "e2e source",
        targetSessionId: target,
        targetDisplayName: "e2e target",
        viewerSessionId: target,
      }),
    ).toBe("will notify e2e source when idle");

    expect(
      sessionIdlePartyLabel({
        targetSessionId: target,
        targetDisplayName: null,
        viewerSessionId: owner,
        ownerSessionId: owner,
      }),
    ).toBe(`waiting for ${target} to go idle`);

    expect(
      sessionIdlePartyLabel({
        ownerSessionId: owner,
        ownerDisplayName: null,
        targetSessionId: target,
        viewerSessionId: target,
      }),
    ).toBe(`will notify ${owner} when idle`);

    expect(
      sessionIdlePartyLabel({
        ownerSessionId: null,
        ownerDisplayName: null,
        targetSessionId: target,
        viewerSessionId: target,
      }),
    ).toBe("will notify another session when idle");

    expect(isGeneratedSessionIdleTitle(null, target)).toBe(true);
    expect(isGeneratedSessionIdleTitle("", target)).toBe(true);
    expect(isGeneratedSessionIdleTitle(`Wait for ${target}`, target)).toBe(true);
    expect(isGeneratedSessionIdleTitle("Custom wait", target)).toBe(false);
  });
});
