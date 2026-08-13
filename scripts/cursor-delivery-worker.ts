#!/usr/bin/env node
import { Effect } from "effect";
import { cursorRestDeliveryWorkerLoop } from "../server/cursor/rest-delivery-worker.ts";
import { workerVersion } from "../server/external-cli/worker-env.ts";
import { isCursorSessionId } from "../server/session-id.ts";

const sessionId = process.argv[2];

if (!sessionId || !isCursorSessionId(sessionId)) {
  console.error("Usage: cursor-delivery-worker.ts <cur_session_id>");
  process.exit(1);
}

console.log(
  JSON.stringify({
    msg: "cursor delivery worker started",
    mode: process.env.SAY_TO_ME_CURSOR_WORKER_MODE ?? "echo",
    pid: process.pid,
    sessionId,
    workerVersion: workerVersion("CURSOR"),
  }),
);

Effect.runPromise(cursorRestDeliveryWorkerLoop(sessionId)).catch((error) => {
  console.error("[cursor-delivery-worker] crashed:", error);
  process.exit(1);
});
