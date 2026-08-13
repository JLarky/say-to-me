import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  CompactOpenCode,
  type CompactOpenCodeService,
  compactOpenCodeSessionProgram,
} from "./api-routes/opencode-compact.ts";
import { fakeServiceLayer } from "./effect-test-helpers.ts";

function fakeCompactOpenCode(overrides: Partial<CompactOpenCodeService> = {}) {
  return fakeServiceLayer(
    CompactOpenCode,
    (calls) =>
      ({
        ensureSession: (sessionId: string) =>
          Effect.sync(() => {
            calls.push(`ensure:${sessionId}`);
          }),
        compactSession: (sessionId: string) =>
          Effect.sync(() => {
            calls.push(`compact:${sessionId}`);
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
      }) satisfies CompactOpenCodeService,
  );
}

describe("say API: OpenCode compact workflow", () => {
  it("compacts a session through injected Effect dependencies", async () => {
    const fake = fakeCompactOpenCode();

    const payload = await Effect.runPromise(
      compactOpenCodeSessionProgram("ses_c6ba86c3a1e6lbeAiYg2zPDuXi").pipe(
        Effect.provide(fake.layer),
      ),
    );

    expect(payload).toMatchObject({
      ok: true,
      session: { id: "ses_c6ba86c3a1e6lbeAiYg2zPDuXi", opencodeStatus: "idle" },
    });
    expect(fake.calls).toEqual([
      "ensure:ses_c6ba86c3a1e6lbeAiYg2zPDuXi",
      "compact:ses_c6ba86c3a1e6lbeAiYg2zPDuXi",
      "queue:ses_c6ba86c3a1e6lbeAiYg2zPDuXi",
    ]);
  });

  it("maps upstream compact failures without fetching the queue payload", async () => {
    const fake = fakeCompactOpenCode({
      compactSession: (sessionId) =>
        Effect.sync(() => {
          fake.calls.push(`compact:${sessionId}`);
          return { ok: false as const, status: 409, error: "OpenCode returned HTTP 409" };
        }),
    });

    const error = await Effect.runPromise(
      Effect.flip(
        compactOpenCodeSessionProgram("ses_11c453468e85th3bspHqBoGAgA").pipe(
          Effect.provide(fake.layer),
        ),
      ),
    );

    expect(error).toEqual({
      _tag: "CompactOpenCodeUpstreamError",
      error: "OpenCode returned HTTP 409",
      status: 409,
    });
    expect(fake.calls).toEqual([
      "ensure:ses_11c453468e85th3bspHqBoGAgA",
      "compact:ses_11c453468e85th3bspHqBoGAgA",
    ]);
  });

  it("rejects invalid session ids before calling compact dependencies", async () => {
    const fake = fakeCompactOpenCode();

    const error = await Effect.runPromise(
      Effect.flip(compactOpenCodeSessionProgram("not-a-session").pipe(Effect.provide(fake.layer))),
    );

    expect(error).toEqual({
      _tag: "CompactOpenCodeValidationError",
      error: "Invalid OpenCode session id.",
      status: 400,
    });
    expect(fake.calls).toEqual([]);
  });
});
