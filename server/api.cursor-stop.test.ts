import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  StopCursor,
  type StopCursorService,
  stopCursorSessionProgram,
} from "./api-routes/cursor-stop.ts";
import { fakeServiceLayer } from "./effect-test-helpers.ts";

function fakeStopCursor(overrides: Partial<StopCursorService> = {}) {
  return fakeServiceLayer(
    StopCursor,
    (calls) =>
      ({
        ensureSession: (sessionId: string) =>
          Effect.sync(() => {
            calls.push(`ensure:${sessionId}`);
          }),
        stopSession: (sessionId: string) =>
          Effect.sync(() => {
            calls.push(`stop:${sessionId}`);
            return { ok: true as const };
          }),
        queuePayload: (sessionId: string) =>
          Effect.sync(() => {
            calls.push(`queue:${sessionId}`);
            return {
              revision: 1,
              messages: [],
              presence: [],
              session: {
                id: sessionId,
                state: "general" as const,
                alias: null,
                revision: 1,
                createdAt: "2026-06-18 00:00:00",
                updatedAt: "2026-06-18 00:00:00",
                href: `/sessions/${sessionId}`,
                opencodeStatus: "idle" as const,
                opencodeTitle: null,
                opencodeAgent: null,
                opencodeModelProvider: null,
                opencodeModel: null,
                opencodeDirB64: null,
                organizePath: [],
                backend: "cursor" as const,
              },
              sessions: [],
              lastNoteFirstLine: null,
            };
          }),
        ...overrides,
      }) satisfies StopCursorService,
  );
}

describe("say API: Cursor stop workflow", () => {
  it("stops a session through injected Effect dependencies", async () => {
    const fake = fakeStopCursor();
    const sessionId = "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb";

    const payload = await Effect.runPromise(
      stopCursorSessionProgram(sessionId).pipe(Effect.provide(fake.layer)),
    );

    expect(payload).toMatchObject({ ok: true, session: { id: sessionId } });
    expect(fake.calls).toEqual([`ensure:${sessionId}`, `stop:${sessionId}`, `queue:${sessionId}`]);
  });

  it("rejects invalid session ids before calling stop dependencies", async () => {
    const fake = fakeStopCursor();

    const error = await Effect.runPromise(
      Effect.flip(stopCursorSessionProgram("not-a-session").pipe(Effect.provide(fake.layer))),
    );

    expect(error).toEqual({
      _tag: "StopCursorValidationError",
      error: "Invalid Cursor session id.",
      status: 400,
    });
    expect(fake.calls).toEqual([]);
  });
});
