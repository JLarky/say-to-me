import { describe, expect, it } from "vite-plus/test";
import { mapOpenCodeSessionCreateFailure } from "./session-create-result.ts";

describe("mapOpenCodeSessionCreateFailure", () => {
  it("returns a friendly unavailable error when the SDK omits response", () => {
    expect(
      mapOpenCodeSessionCreateFailure({
        response: undefined,
        error: new Error("fetch failed"),
      }),
    ).toEqual({
      ok: false,
      status: 502,
      error: "fetch failed",
    });
  });

  it("returns a default unavailable message when response and error are missing", () => {
    const result = mapOpenCodeSessionCreateFailure({ response: null });
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/OpenCode is unavailable/i);
  });

  it("preserves HTTP status when response exists", () => {
    expect(mapOpenCodeSessionCreateFailure({ response: { status: 503 } })).toEqual({
      ok: false,
      status: 503,
      error: "OpenCode returned HTTP 503",
    });
  });
});
