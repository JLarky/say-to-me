import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  StopClaude,
  type StopClaudeService,
  stopClaudeSessionProgram,
} from "./api-routes/claude-stop.ts";
import { fakeServiceLayer } from "./effect-test-helpers.ts";

function fakeStopClaude(overrides: Partial<StopClaudeService> = {}) {
  return fakeServiceLayer(
    StopClaude,
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
                backend: "claude" as const,
              },
              sessions: [],
              lastNoteFirstLine: null,
            };
          }),
        ...overrides,
      }) satisfies StopClaudeService,
  );
}

describe("say API: Claude stop workflow", () => {
  it("stops a session through injected Effect dependencies", async () => {
    const fake = fakeStopClaude();
    const sessionId = "cc_5c708e22-807e-4579-807a-b56d8e4341e1";

    const payload = await Effect.runPromise(
      stopClaudeSessionProgram(sessionId).pipe(Effect.provide(fake.layer)),
    );

    expect(payload).toMatchObject({ ok: true, session: { id: sessionId } });
    expect(fake.calls).toEqual([`ensure:${sessionId}`, `stop:${sessionId}`, `queue:${sessionId}`]);
  });

  it("rejects invalid session ids before calling stop dependencies", async () => {
    const fake = fakeStopClaude();

    const error = await Effect.runPromise(
      Effect.flip(stopClaudeSessionProgram("not-a-session").pipe(Effect.provide(fake.layer))),
    );

    expect(error).toEqual({
      _tag: "StopClaudeValidationError",
      error: "Invalid Claude session id.",
      status: 400,
    });
    expect(fake.calls).toEqual([]);
  });
});
