#!/usr/bin/env node
import { Effect } from "effect";
import { claudeRestDeliveryWorkerLoop } from "../server/claude/rest-delivery-worker.ts";
import { workerVersion } from "../server/external-cli/worker-env.ts";
import { isClaudeSessionId } from "../server/session-id.ts";

const sessionId = process.argv[2];

if (!sessionId || !isClaudeSessionId(sessionId)) {
  console.error("Usage: claude-delivery-worker.ts <cc_session_id>");
  process.exit(1);
}

console.log(
  JSON.stringify({
    msg: "claude delivery worker started",
    mode: process.env.SAY_TO_ME_CLAUDE_WORKER_MODE ?? "echo",
    pid: process.pid,
    sessionId,
    workerVersion: workerVersion("CLAUDE"),
  }),
);

Effect.runPromise(claudeRestDeliveryWorkerLoop(sessionId)).catch((error) => {
  console.error("[claude-delivery-worker] crashed:", error);
  process.exit(1);
});
