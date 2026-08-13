import { describe, expect, it } from "vite-plus/test";
import {
  formatSseEvent,
  ssePingFrame,
  sseRetryLine,
  sseSnapshotFrame,
  type SseClient,
} from "./client.ts";
import { createSseWebResponse } from "./stream.ts";

describe("sse client frames", () => {
  it("formats retry, ping, snapshot, and named events", () => {
    expect(sseRetryLine).toBe("retry: 3000\n\n");
    expect(ssePingFrame()).toBe("event: ping\ndata: {}\n\n");
    expect(sseSnapshotFrame({ revision: 3, messages: [] })).toBe(
      'id: 3\nevent: snapshot\ndata: {"revision":3,"messages":[]}\n\n',
    );
    expect(formatSseEvent({ ok: true }, "connected")).toBe(
      'event: connected\ndata: {"ok":true}\n\n',
    );
  });

  it("writes chunks through abstract clients", () => {
    const chunks: string[] = [];
    const client: SseClient = {
      write(chunk) {
        chunks.push(chunk);
      },
    };

    void client.write(sseRetryLine);
    void client.write(formatSseEvent({ notifications: [] }, "snapshot"));

    expect(chunks).toEqual(["retry: 3000\n\n", 'event: snapshot\ndata: {"notifications":[]}\n\n']);
  });
});

describe("createSseWebResponse", () => {
  it("returns a readable SSE stream with retry and connect payload", async () => {
    const response = createSseWebResponse((client) => {
      void client.write(formatSseEvent({ ok: true }, "connected"));
      client.close?.();
    });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");

    const body = await response.text();
    expect(body).toContain("retry: 3000\n\n");
    expect(body).toContain('event: connected\ndata: {"ok":true}\n\n');
  });

  it("ignores writes after the stream is cancelled", async () => {
    let sseClient: SseClient | undefined;
    const response = createSseWebResponse((client) => {
      sseClient = client;
    });

    await response.body?.cancel();
    expect(sseClient).toBeDefined();
    expect(() => {
      void sseClient!.write(formatSseEvent({ late: true }, "snapshot"));
    }).not.toThrow();
  });

  it("ignores writes after the stream is closed", async () => {
    let sseClient: SseClient | undefined;
    const response = createSseWebResponse((client) => {
      sseClient = client;
      client.close?.();
    });

    await response.text();
    expect(sseClient).toBeDefined();
    expect(() => {
      void sseClient!.write(formatSseEvent({ late: true }, "snapshot"));
    }).not.toThrow();
  });

  it("invokes sync onConnect cleanup on cancel", async () => {
    let cleaned = false;
    const response = createSseWebResponse(() => () => {
      cleaned = true;
    });

    await response.body?.cancel();
    expect(cleaned).toBe(true);
  });

  it("invokes async onConnect cleanup when cancel races connect", async () => {
    let cleaned = false;
    let resolveConnect!: (cleanup: () => void) => void;
    const response = createSseWebResponse(
      () =>
        new Promise<() => void>((resolve) => {
          resolveConnect = resolve;
        }),
    );

    await response.body?.cancel();
    expect(cleaned).toBe(false);

    resolveConnect(() => {
      cleaned = true;
    });
    await Promise.resolve();
    expect(cleaned).toBe(true);
  });
});
