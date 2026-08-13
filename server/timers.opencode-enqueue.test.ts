import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cause, Effect, Exit, TestContext } from "effect";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-timer-opencode-enqueue-"));
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
const { JarvisTimerLive, JarvisTimerRepository, runDueJarvisTimerOnce } =
  await import("./timers.ts");

describe("Jarvis timer OpenCode enqueue failures", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("releases a due OpenCode timer for retry when enqueue throws, without dying", async () => {
    const sessionId = "ses_e7629ddd9064axVSyjejHALLdN";
    ensureSession(sessionId);

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* JarvisTimerRepository;
        yield* repository.create({
          sessionId,
          title: "Check build",
          message: "Review status.",
          dueAt: 0,
          intervalMs: null,
        });
      }).pipe(Effect.provide(JarvisTimerLive)),
    );

    const exit = await Effect.runPromiseExit(
      runDueJarvisTimerOnce().pipe(
        Effect.provide(JarvisTimerLive),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(false);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe(true);

    const timers = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* JarvisTimerRepository;
        return yield* repository.list(sessionId);
      }).pipe(Effect.provide(JarvisTimerLive)),
    );

    expect(timers).toHaveLength(1);
    expect(timers[0]).toMatchObject({
      status: "active",
      lockedAt: null,
      lockedBy: null,
    });
    expect(timers[0]?.lastError).toContain("sqlite enqueue exploded");
    expect(timers[0]?.nextFireAt).toBeGreaterThan(0);
  });
});
