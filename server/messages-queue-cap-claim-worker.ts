/**
 * Worker-thread entry for concurrent queue-cap claim regression tests.
 * Opens its own better-sqlite3 connection without importing the app DB singleton.
 */
import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import { claimQueuedAgentSlot } from "./messages-queue-cap-claim.ts";

const data = workerData as {
  dbPath: string;
  cap: number;
  sessionId: string;
  text: string;
  overflow: "force" | null;
  clientMessageId: string | null;
};

const db = new Database(data.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 10000");

try {
  const result = claimQueuedAgentSlot(db, {
    sessionId: data.sessionId,
    text: data.text,
    extraMarkdown: null,
    pushNotificationText: null,
    links: null,
    sessionRefs: null,
    clientMessageId: data.clientMessageId,
    overflow: data.overflow,
    cap: data.cap,
  });
  parentPort?.postMessage(
    result.ok
      ? { ok: true as const, messageId: result.id, existing: result.existing }
      : { ok: false as const, error: result.error },
  );
} finally {
  db.close();
}
