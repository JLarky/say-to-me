import {
  recordSseClose,
  recordSseOpen,
  recordSseWrite,
  recordSseWriteFailure,
} from "./diagnostics.ts";
import { sseRetryLine, type SseClient } from "./client.ts";
import { sseStreamHeaders } from "./express.ts";

export function createSseWebResponse(
  onConnect: (client: SseClient) => void | (() => void) | Promise<void | (() => void)>,
  options: {
    retry?: boolean;
    accelBuffering?: boolean;
    headers?: Record<string, string>;
    /** Stream kind for diagnostics (no session ids). */
    kind?: string;
  } = {},
): Response {
  const encoder = new TextEncoder();
  const kind = options.kind ?? "unknown";
  let cleanup: (() => void) | void;
  let closed = false;
  let cleaned = false;

  const finish = () => {
    if (cleaned) return;
    cleaned = true;
    closed = true;
    recordSseClose(kind);
    try {
      cleanup?.();
    } catch {
      // Cleanup must not throw out of cancel/close.
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      recordSseOpen(kind);

      const client: SseClient = {
        write(chunk) {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
            recordSseWrite(kind);
          } catch {
            recordSseWriteFailure(kind);
            // Stream is unusable; run cleanup once and drop active gauge.
            finish();
          }
        },
        close() {
          if (closed && cleaned) return;
          try {
            if (!closed) controller.close();
          } catch {
            // ignore double-close
          }
          finish();
        },
      };

      if (options.retry !== false) {
        void client.write(sseRetryLine);
      }

      const connected = onConnect(client);
      if (connected instanceof Promise) {
        void connected.then((result) => {
          cleanup = result;
          // Cancel may have already finished the connection before this microtask.
          // Still run cleanup once without double-counting close.
          if (closed) {
            try {
              result?.();
            } catch {
              // ignore
            }
            cleanup = undefined;
          }
        });
      } else {
        cleanup = connected;
        // Enqueue can fail during start before synchronous cleanup is assigned.
        if (closed) {
          try {
            connected?.();
          } catch {
            // ignore
          }
          cleanup = undefined;
        }
      }
    },
    cancel() {
      finish();
    },
  });

  const headers = new Headers({
    ...sseStreamHeaders,
    ...options.headers,
  });
  if (options.accelBuffering !== false) {
    headers.set("X-Accel-Buffering", "no");
  }

  return new Response(stream, { headers });
}
