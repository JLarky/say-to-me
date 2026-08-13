import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  formatSseDiagnosticsLog,
  flushSseDiagnosticsWindow,
  getSseDiagnosticsSnapshot,
  ensureSseDiagnosticsLogging,
  recordSseBroadcast,
  recordSseClose,
  recordSseOpen,
  recordSseWrite,
  resetSseDiagnostics,
  setSseDiagnosticsLogger,
  stopSseDiagnosticsLogging,
} from "./diagnostics.ts";
import { createSseWebResponse } from "./stream.ts";
import { formatSseEvent } from "./client.ts";

beforeEach(() => {
  resetSseDiagnostics();
  delete process.env.SAY_TO_ME_SSE_DIAGNOSTICS;
  delete process.env.SAY_TO_ME_SSE_DIAG_VERBOSE;
  vi.useFakeTimers();
});

afterEach(() => {
  stopSseDiagnosticsLogging();
  resetSseDiagnostics();
  delete process.env.SAY_TO_ME_SSE_DIAGNOSTICS;
  delete process.env.SAY_TO_ME_SSE_DIAG_VERBOSE;
  vi.useRealTimers();
});

describe("sse diagnostics counters", () => {
  it("keeps periodic logging off by default", () => {
    const logs: string[] = [];
    setSseDiagnosticsLogger((line) => logs.push(line));
    recordSseOpen("queue");

    ensureSseDiagnosticsLogging();
    vi.advanceTimersByTime(5000);

    expect(logs).toEqual([]);
    expect(getSseDiagnosticsSnapshot().kinds.queue?.active).toBe(1);
  });

  it("logs diagnostics when enabled, with verbose session detail as a secondary opt-in", () => {
    const logs: string[] = [];
    process.env.SAY_TO_ME_SSE_DIAGNOSTICS = "1";
    process.env.SAY_TO_ME_SSE_DIAG_VERBOSE = "1";
    setSseDiagnosticsLogger((line) => logs.push(line));
    recordSseOpen("queue");
    recordSseBroadcast("ses_test");

    ensureSseDiagnosticsLogging();
    vi.advanceTimersByTime(5000);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("[sse] last 5s:");
    expect(logs[0]).toContain("broadcasts=1");
    expect(logs[0]).toContain("ses_test");
  });

  it("increments active/opened on connect and decrements on cancel once", async () => {
    let cleanupCalls = 0;
    const response = createSseWebResponse(
      (client) => {
        void client.write(formatSseEvent({ ok: true }, "connected"));
        return () => {
          cleanupCalls += 1;
        };
      },
      { kind: "queue" },
    );

    let snap = getSseDiagnosticsSnapshot();
    expect(snap.kinds.queue?.active).toBe(1);
    expect(snap.kinds.queue?.opened).toBe(1);
    expect(snap.kinds.queue?.writes).toBeGreaterThanOrEqual(1); // retry + event

    await response.body?.cancel();
    await response.body?.cancel(); // second cancel must not double-count close

    snap = getSseDiagnosticsSnapshot();
    expect(snap.kinds.queue?.active).toBe(0);
    expect(snap.kinds.queue?.closed).toBe(1);
    expect(cleanupCalls).toBe(1);
  });

  it("records an enqueue failure and cleans up the connection", async () => {
    const originalReadableStream = globalThis.ReadableStream;
    const originalResponse = globalThis.Response;
    let cleanupCalls = 0;

    class ThrowingReadableStream {
      readonly body = this;
      private readonly source: UnderlyingSource<Uint8Array>;

      constructor(source: UnderlyingSource<Uint8Array>) {
        this.source = source;
        source.start?.({
          enqueue: () => {
            throw new Error("enqueue failed");
          },
          close: () => {},
          error: () => {},
          desiredSize: 1,
        } as ReadableStreamDefaultController<Uint8Array>);
      }

      cancel(): Promise<void> | undefined {
        return this.source.cancel?.() as Promise<void> | undefined;
      }
    }

    class TestResponse {
      readonly body: ThrowingReadableStream;

      constructor(body: ThrowingReadableStream) {
        this.body = body;
      }
    }

    Object.defineProperty(globalThis, "ReadableStream", {
      configurable: true,
      writable: true,
      value: ThrowingReadableStream,
    });
    Object.defineProperty(globalThis, "Response", {
      configurable: true,
      writable: true,
      value: TestResponse,
    });

    try {
      const response = createSseWebResponse(
        (client) => {
          void client.write(formatSseEvent({ ok: true }, "snapshot"));
          return () => {
            cleanupCalls += 1;
          };
        },
        { kind: "agent" },
      );

      const snap = getSseDiagnosticsSnapshot();
      expect(snap.kinds.agent).toEqual({
        active: 0,
        opened: 1,
        closed: 1,
        writes: 0,
        writeFailures: 1,
      });
      expect(cleanupCalls).toBe(1);
      await response.body?.cancel();
      expect(getSseDiagnosticsSnapshot().kinds.agent?.closed).toBe(1);
    } finally {
      Object.defineProperty(globalThis, "ReadableStream", {
        configurable: true,
        writable: true,
        value: originalReadableStream,
      });
      Object.defineProperty(globalThis, "Response", {
        configurable: true,
        writable: true,
        value: originalResponse,
      });
    }
  });

  it("tracks reconnect as open + close pairs without double cleanup", async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = createSseWebResponse(() => () => {}, { kind: "session-list" });
      await response.body?.cancel();
    }
    const snap = getSseDiagnosticsSnapshot();
    expect(snap.kinds["session-list"]?.opened).toBe(3);
    expect(snap.kinds["session-list"]?.closed).toBe(3);
    expect(snap.kinds["session-list"]?.active).toBe(0);
  });

  it("aggregates broadcasts without requiring session ids in the default log", () => {
    recordSseBroadcast("ses_a");
    recordSseBroadcast("ses_a");
    recordSseBroadcast("ses_b");
    const snap = getSseDiagnosticsSnapshot();
    expect(snap.broadcasts).toBe(3);
    const log = formatSseDiagnosticsLog(snap);
    expect(log).toContain("[sse] broadcasts in last 5s: 3");
    expect(log).toContain("broadcasts=3");
    expect(log).not.toContain("ses_a");
    expect(log).not.toContain("ses_b");
  });

  it("flushes window counters while preserving active gauge", () => {
    recordSseOpen("queue");
    recordSseWrite("queue");
    recordSseBroadcast("ses_x");
    flushSseDiagnosticsWindow();
    const snap = getSseDiagnosticsSnapshot();
    expect(snap.kinds.queue?.active).toBe(1);
    expect(snap.kinds.queue?.opened).toBe(0);
    expect(snap.kinds.queue?.writes).toBe(0);
    expect(snap.broadcasts).toBe(0);
    recordSseClose("queue");
  });
});
