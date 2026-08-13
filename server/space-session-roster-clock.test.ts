import { Cause, Clock, Duration, Effect, Exit, TestClock, TestContext } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { deriveSpaceRosterStatus, loadTimerSummariesBatch } from "./space-session-roster.ts";
import { readSpaceState, resetSpaceStateDepsForTest, setSpaceStateDepsForTest } from "./spaces.ts";

describe("space roster Effect clock boundary", () => {
  afterEach(() => {
    resetSpaceStateDepsForTest();
  });

  it("takes one TestClock snapshot for recent-vs-idle derivation", async () => {
    const activityAt = "2026-07-19 11:58:00";
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-07-19T12:00:00Z"));
        const now = yield* Clock.currentTimeMillis;
        expect(
          deriveSpaceRosterStatus({
            cachedOpenCodeStatus: null,
            cachedActivityStatus: null,
            latestDeliveryStatus: "sent",
            latestDeliveryError: null,
            latestSayAuthor: "agent",
            activityAt,
            nowMs: now,
          }),
        ).toEqual({ rosterStatus: "working", rosterStatusLabel: "WORKING" });

        yield* TestClock.adjust(Duration.minutes(10));
        const later = yield* Clock.currentTimeMillis;
        expect(
          deriveSpaceRosterStatus({
            cachedOpenCodeStatus: null,
            cachedActivityStatus: null,
            latestDeliveryStatus: "sent",
            latestDeliveryError: null,
            latestSayAuthor: "agent",
            activityAt,
            nowMs: later,
          }),
        ).toEqual({ rosterStatus: "idle", rosterStatusLabel: "IDLE" });
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });

  it("readSpaceState builds under a fixed TestClock without sleeping on wall time", async () => {
    const fixed = 1_721_390_400_000;
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(fixed);
        const before = yield* Clock.currentTimeMillis;
        const state = yield* readSpaceState;
        const after = yield* Clock.currentTimeMillis;
        expect(before).toBe(fixed);
        expect(after).toBe(fixed);
        expect(Array.isArray(state.spaces)).toBe(true);
        // Same snapshot stays valid for pure timer helpers.
        expect(loadTimerSummariesBatch([], before).size).toBe(0);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });

  it("maps sync spaceState DB throws to SpacesError Fail, not Die", async () => {
    setSpaceStateDepsForTest({
      throwOnRead: () => {
        throw Object.assign(new Error("simulated spaceState DB failure"), { status: 500 });
      },
    });
    const exit = await Effect.runPromiseExit(readSpaceState);
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.isDie(exit.cause)).toBe(false);
    expect([...Cause.failures(exit.cause)]).toEqual([
      {
        _tag: "SpacesError",
        error: "simulated spaceState DB failure",
        status: 500,
      },
    ]);
  });

  it("GET /api/spaces returns the typed public error when spaceState DB throws", async () => {
    setSpaceStateDepsForTest({
      throwOnRead: () => {
        throw Object.assign(new Error("simulated spaceState DB failure"), { status: 500 });
      },
    });
    const { dispatchEffectApiRequest } = await import("./api-routes/effect-api.ts");
    const response = await dispatchEffectApiRequest(new Request("http://say.local/api/spaces"));
    expect(response?.status).toBe(500);
    expect(await response!.json()).toEqual({ error: "simulated spaceState DB failure" });
  });
});
