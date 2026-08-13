import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  StopOpenCode,
  type StopOpenCodeService,
  stopOpenCodeSessionProgram,
} from "./api-routes/opencode-stop.ts";
import { fakeServiceLayer } from "./effect-test-helpers.ts";

function fakeStopOpenCode(overrides: Partial<StopOpenCodeService> = {}) {
  return fakeServiceLayer(
    StopOpenCode,
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
                backend: "opencode" as const,
              },
              sessions: [],
              lastNoteFirstLine: null,
            };
          }),
        ...overrides,
      }) satisfies StopOpenCodeService,
  );
}

describe("say API: OpenCode stop workflow", () => {
  it("stops a session through injected Effect dependencies", async () => {
    const fake = fakeStopOpenCode();

    const payload = await Effect.runPromise(
      stopOpenCodeSessionProgram("ses_44b5210cdae0o6P062SvxTO4qq").pipe(Effect.provide(fake.layer)),
    );

    expect(payload).toMatchObject({
      ok: true,
      session: { id: "ses_44b5210cdae0o6P062SvxTO4qq", opencodeStatus: "idle" },
    });
    expect(fake.calls).toEqual([
      "ensure:ses_44b5210cdae0o6P062SvxTO4qq",
      "stop:ses_44b5210cdae0o6P062SvxTO4qq",
      "queue:ses_44b5210cdae0o6P062SvxTO4qq",
    ]);
  });

  it("maps upstream abort failures without fetching the queue payload", async () => {
    const fake = fakeStopOpenCode({
      stopSession: (sessionId) =>
        Effect.sync(() => {
          fake.calls.push(`stop:${sessionId}`);
          return { ok: false as const, status: 409, error: "OpenCode returned HTTP 409" };
        }),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        stopOpenCodeSessionProgram("ses_74dc3e166ae9lBA6fmt7dcnqIq").pipe(
          Effect.provide(fake.layer),
        ),
      ),
    );

    expect(error).toEqual({
      _tag: "StopOpenCodeUpstreamError",
      error: "OpenCode returned HTTP 409",
      status: 409,
    });
    expect(fake.calls).toEqual([
      "ensure:ses_74dc3e166ae9lBA6fmt7dcnqIq",
      "stop:ses_74dc3e166ae9lBA6fmt7dcnqIq",
    ]);
  });

  it("rejects invalid session ids before calling stop dependencies", async () => {
    const fake = fakeStopOpenCode();

    const error = await Effect.runPromise(
      Effect.flip(stopOpenCodeSessionProgram("not-a-session").pipe(Effect.provide(fake.layer))),
    );

    expect(error).toEqual({
      _tag: "StopOpenCodeValidationError",
      error: "Invalid OpenCode session id.",
      status: 400,
    });
    expect(fake.calls).toEqual([]);
  });
});
