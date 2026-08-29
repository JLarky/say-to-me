export const SESSION_QUEUE_MULTIPLEX_URL = "/api/session-queues/events";
export const SESSION_QUEUE_MULTIPLEX_FLAG_KEY = "say-to-me:session-queue-multiplex";
export const SESSION_QUEUE_MULTIPLEX_MAX_IDS = 24;

export type SessionQueuePortMessage =
  | { type: "subscribe"; sessionId: string }
  | { type: "unsubscribe"; sessionId: string }
  | { type: "disconnect" };

export type SessionQueueWorkerMessage =
  | {
      type: "status";
      mode: "shared" | "connecting" | "error";
      sessionIds: string[];
      error?: string;
    }
  | { type: "event"; sessionId: string; eventType: string; data: string };
