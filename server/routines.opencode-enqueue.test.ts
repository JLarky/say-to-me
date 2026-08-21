import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cause, Effect, Exit, TestContext } from "effect";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-routine-opencode-enqueue-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

vi.mock("./opencode/durable-delivery.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./opencode/durable-delivery.ts")>();
  return {
    ...actual,
    enqueueOpenCodeDeliveryJob: () => {
      throw new Error("sqlite enqueue exploded");
    },
  };
});

const { drizzleSqlite } = await import("./db/index.ts");
const { ensureSession } = await import("./sessions.ts");
const { RoutineLive, RoutineRepository, runDueRoutineOnce } = await import("./routines.ts");

describe("routine OpenCode enqueue failures", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("releases a due routine for retry when enqueue throws, without dying", async () => {
    const sessionId = "ses_e7629ddd9064axVSyjejHALLdN";
    ensureSession(sessionId);

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* RoutineRepository;
        yield* repository.create({
          ownerSessionId: sessionId,
          title: "Check build",
          trigger: { kind: "schedule", dueAt: 0, intervalMs: null },
          action: {
            kind: "deliver_prompt",
            title: "Check build",
            message: "Review status.",
          },
        });
      }).pipe(Effect.provide(RoutineLive)),
    );

    const exit = await Effect.runPromiseExit(
      runDueRoutineOnce().pipe(
        Effect.provide(RoutineLive),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(true);

    const routines = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* RoutineRepository;
        return yield* repository.list(sessionId);
      }).pipe(Effect.provide(RoutineLive)),
    );

    expect(routines).toHaveLength(1);
    expect(routines[0]).toMatchObject({
      status: "active",
      lockedAt: null,
      lockedBy: null,
    });
    expect(routines[0]?.lastError).toContain("sqlite enqueue exploded");
    expect(routines[0]?.trigger.nextFireAt).toBeGreaterThan(0);
  });
});
