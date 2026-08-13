import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import { createSessionActivityAdapter } from "./activity-adapter.ts";
import { createSessionStopperAdapter } from "./stop-adapter.ts";
import { createSessionTitleAdapter } from "./title-adapter.ts";

describe("SessionActivity", () => {
  it("creates adapter from external-cli hub", async () => {
    const mockHub = {
      getSnapshot: async (_sessionId: string) => ({
        items: [],
        lastTimestamp: null,
        busy: false,
        status: "idle" as const,
      }),
      subscribe: () => () => {},
    };

    const adapter = createSessionActivityAdapter(mockHub);
    const result = await Effect.runPromise(adapter.getSnapshot("test-session"));
    expect(result.status).toBe("idle");
    expect(result.items).toEqual([]);
  });

  it("returns ActivityError on failure", async () => {
    const mockHub = {
      getSnapshot: async () => {
        throw new Error("test error");
      },
      subscribe: () => () => {},
    };

    const adapter = createSessionActivityAdapter(mockHub);
    const result = await Effect.runPromiseExit(adapter.getSnapshot("test-session"));
    expect(result._tag).toBe("Failure");
  });
});

describe("SessionStopper", () => {
  it("creates adapter from external-cli stop function", async () => {
    const mockStop = async () => ({ ok: true as const });

    const adapter = createSessionStopperAdapter({ stopSession: mockStop });
    const result = await Effect.runPromise(adapter.stop("test-session"));
    expect(result.ok).toBe(true);
  });

  it("returns StopError on failure", async () => {
    const mockStop = async () => {
      throw new Error("test error");
    };

    const adapter = createSessionStopperAdapter({ stopSession: mockStop });
    const result = await Effect.runPromiseExit(adapter.stop("test-session"));
    expect(result._tag).toBe("Failure");
  });
});

describe("SessionTitle", () => {
  it("creates adapter from external-cli title reader", () => {
    const mockGetTitle = (sessionId: string) => `Title for ${sessionId}`;

    const adapter = createSessionTitleAdapter({ getTitle: mockGetTitle });
    const result = Effect.runSync(adapter.getTitle("test-session"));
    expect(result).toBe("Title for test-session");
  });

  it("returns null when title reader returns null", () => {
    const mockGetTitle = () => null;

    const adapter = createSessionTitleAdapter({ getTitle: mockGetTitle });
    const result = Effect.runSync(adapter.getTitle("test-session"));
    expect(result).toBeNull();
  });
});
