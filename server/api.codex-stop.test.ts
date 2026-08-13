import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  StopCodex,
  type StopCodexService,
  stopCodexSessionProgram,
} from "./api-routes/codex-stop.ts";
import { fakeServiceLayer } from "./effect-test-helpers.ts";

function fakeStopCodex(overrides: Partial<StopCodexService> = {}) {
  return fakeServiceLayer(
    StopCodex,
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
                backend: "codex" as const,
              },
              sessions: [],
              lastNoteFirstLine: null,
            };
          }),
        ...overrides,
      }) satisfies StopCodexService,
  );
}

describe("say API: Codex stop workflow", () => {
  it("stops a session through injected Effect dependencies", async () => {
    const fake = fakeStopCodex();
    const sessionId = "cx_e6ca1259-5b7f-4de3-afd5-a877811435cb";

    const payload = await Effect.runPromise(
      stopCodexSessionProgram(sessionId).pipe(Effect.provide(fake.layer)),
    );

    expect(payload).toMatchObject({ ok: true, session: { id: sessionId } });
    expect(fake.calls).toEqual([`ensure:${sessionId}`, `stop:${sessionId}`, `queue:${sessionId}`]);
  });

  it("rejects invalid session ids before calling stop dependencies", async () => {
    const fake = fakeStopCodex();

    const error = await Effect.runPromise(
      Effect.flip(stopCodexSessionProgram("not-a-session").pipe(Effect.provide(fake.layer))),
    );

    expect(error).toEqual({
      _tag: "StopCodexValidationError",
      error: "Invalid Codex session id.",
      status: 400,
    });
    expect(fake.calls).toEqual([]);
  });
});
