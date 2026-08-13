import { Either, Effect, Fiber } from "effect";
import { type as arktype } from "arktype";
import { formatArkErrors, safeJsonParseWithError } from "@say-to-me/runtime-validation";
import { createMessageResult } from "../create-message.ts";
import { maxTotalMessages } from "../config.ts";
import { getAppSettings, type PaseoInstance } from "../settings.ts";
import { getSession, listSessions } from "../sessions.ts";
import { detectSessionBackend, paseoChatRoomUuid } from "../session-id.ts";
import {
  registerPaseoChatListenerStarter,
  registerPaseoChatListenerStopper,
} from "./chat-listener-lifecycle.ts";
import { PASEO_AGENT_ID, paseoChatReadArgs, paseoChatWaitArgs, runPaseoCommand } from "./client.ts";

const PaseoChatMessage = arktype({
  id: "string",
  body: "string",
  "createdAt?": "string",
  "author?": "string",
  "authorName?": "string | null",
});
const PaseoChatMessages = PaseoChatMessage.array();
type PaseoChatMessageRow = typeof PaseoChatMessage.infer;
type ListenerError = Error;
const activeListeners = new Map<string, Fiber.RuntimeFiber<void, never>>();
const LISTEN_TIMEOUT_MS = Number(process.env.SAY_TO_ME_PASEO_CHAT_WAIT_TIMEOUT_MS || 35_000);
const RETRY_DELAY_MS = Number(process.env.SAY_TO_ME_PASEO_CHAT_RETRY_MS || 1_000);

function isMissingRoom(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /room not found|chat room.*not found|unknown room/i.test(text);
}

function runListenerCommand(
  instance: Parameters<typeof runPaseoCommand>[0],
  args: string[],
): Effect.Effect<{ stdout: string; stderr: string }, ListenerError> {
  return Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.tryPromise({
        try: () =>
          runPaseoCommand(instance, args, {
            timeoutMs: LISTEN_TIMEOUT_MS,
            signal: controller.signal,
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    (controller) => Effect.sync(() => controller.abort()),
  );
}

export function selectPaseoChatHydrationRows(
  rows: readonly PaseoChatMessageRow[],
  limit = maxTotalMessages(),
): PaseoChatMessageRow[] {
  return [...rows]
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    .slice(-limit);
}

export function parsePaseoChatMessages(stdout: string): PaseoChatMessageRow[] {
  const raw = stdout.trim();
  const parsed = safeJsonParseWithError(PaseoChatMessages, raw);
  if (!parsed.ok) {
    const detail =
      parsed.error instanceof arktype.errors ? formatArkErrors(parsed.error) : parsed.error.message;
    throw new Error(
      `Paseo chat returned an invalid message payload: ${detail} (stdout length ${raw.length}).`,
      { cause: parsed.error },
    );
  }
  return parsed.value;
}

/** Drop STM-originated posts so outbound delivery does not echo back into the session. */
export function filterInboundPaseoChatMessages(
  rows: readonly PaseoChatMessageRow[],
): PaseoChatMessageRow[] {
  return rows.filter((row) => row.author !== PASEO_AGENT_ID);
}

async function importMessages(
  sessionId: string,
  rows: readonly PaseoChatMessageRow[],
  mode: "hydration" | "live",
) {
  for (const row of selectPaseoChatHydrationRows(filterInboundPaseoChatMessages(rows))) {
    if (!getSession(sessionId)) break;
    const input = {
      sessionId,
      text: row.body,
      author: "agent" as const,
      links: null,
      sessionRefs: null,
      clientMessageId: row.id,
      extractInlineImages: false,
      paseoAuthor: row.author ?? null,
      paseoAuthorName: row.authorName ?? null,
    };
    const result = await createMessageResult({
      ...input,
      agentMessageStatus: mode === "live" ? "queued" : "received",
      notifyAgent: mode === "live",
    });
    if (result.status >= 400 && mode === "live") {
      const fallback = await createMessageResult({
        ...input,
        agentMessageStatus: "received",
        notifyAgent: false,
      });
      if (fallback.status < 400) continue;
    }
    if (result.status >= 400) throw new Error("Failed to import Paseo message " + row.id + ".");
  }
}

function parsePaseoChatMessagesEffect(
  stdout: string,
): Effect.Effect<PaseoChatMessageRow[], ListenerError> {
  return Effect.try({
    try: () => parsePaseoChatMessages(stdout),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });
}
function readHistoryEffect(
  sessionId: string,
  instanceId: string,
  roomId: string,
): Effect.Effect<PaseoInstance, ListenerError> {
  return Effect.gen(function* () {
    const instance = getAppSettings().paseoInstances.find((entry) => entry.id === instanceId);
    if (!instance)
      return yield* Effect.fail(new Error("Paseo instance " + instanceId + " was not found."));
    const result = yield* runListenerCommand(
      instance,
      paseoChatReadArgs(roomId, instance.host, maxTotalMessages()),
    );
    const rows = yield* parsePaseoChatMessagesEffect(result.stdout);
    yield* Effect.tryPromise(() => importMessages(sessionId, rows, "hydration"));
    return instance;
  });
}

function listenerEffect(sessionId: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.sleep(0);
    const session = getSession(sessionId);
    const instanceId = session?.paseoInstanceId?.trim();
    if (
      !session ||
      session.state === "archived" ||
      detectSessionBackend(sessionId) !== "paseo-chat" ||
      !instanceId
    )
      return;
    const roomId = paseoChatRoomUuid(sessionId);
    const initial = yield* Effect.either(readHistoryEffect(sessionId, instanceId, roomId));
    if (Either.isLeft(initial)) {
      if (!isMissingRoom(initial.left)) {
        console.error("[paseo-chat] initial history failed for " + sessionId + ":", initial.left);
      }
      return;
    }
    const instance = initial.right;
    let failures = 0;
    let waitFiber = yield* Effect.fork(
      runListenerCommand(instance, paseoChatWaitArgs(roomId, instance.host)),
    );
    while (true) {
      const currentSession = getSession(sessionId);
      if (!currentSession || currentSession.state === "archived") break;
      const waited = yield* Effect.either(Fiber.join(waitFiber));
      if (Either.isLeft(waited)) {
        const error = waited.left;
        if (isMissingRoom(error)) return;
        failures += 1;
        yield* Effect.sleep(Math.min(30_000, RETRY_DELAY_MS * 2 ** Math.min(failures - 1, 5)));
        waitFiber = yield* Effect.fork(
          runListenerCommand(instance, paseoChatWaitArgs(roomId, instance.host)),
        );
        continue;
      }
      // Establish the next wait before doing reconciliation. The standard CLI's
      // wait command performs its own preflight read; starting it first prevents
      // messages posted during reconciliation from becoming an already-skipped
      // baseline that waits for the full timeout.
      const nextWaitFiber = yield* Effect.fork(
        runListenerCommand(instance, paseoChatWaitArgs(roomId, instance.host)),
      );
      const rows = yield* Effect.either(parsePaseoChatMessagesEffect(waited.right.stdout));
      if (Either.isLeft(rows)) {
        yield* Fiber.interrupt(nextWaitFiber);
        failures += 1;
        yield* Effect.sleep(Math.min(30_000, RETRY_DELAY_MS * 2 ** Math.min(failures - 1, 5)));
        waitFiber = yield* Effect.fork(
          runListenerCommand(instance, paseoChatWaitArgs(roomId, instance.host)),
        );
        continue;
      }
      const imported = yield* Effect.either(
        Effect.tryPromise(() => importMessages(sessionId, rows.right, "live")),
      );
      if (Either.isLeft(imported)) {
        yield* Fiber.interrupt(nextWaitFiber);
        failures += 1;
        yield* Effect.sleep(Math.min(30_000, RETRY_DELAY_MS * 2 ** Math.min(failures - 1, 5)));
        waitFiber = yield* Effect.fork(
          runListenerCommand(instance, paseoChatWaitArgs(roomId, instance.host)),
        );
        continue;
      }
      const reconciled = yield* Effect.either(
        runListenerCommand(instance, paseoChatReadArgs(roomId, instance.host, maxTotalMessages())),
      );
      if (Either.isLeft(reconciled)) {
        yield* Fiber.interrupt(nextWaitFiber);
        const error = reconciled.left;
        if (isMissingRoom(error)) return;
        failures += 1;
        yield* Effect.sleep(Math.min(30_000, RETRY_DELAY_MS * 2 ** Math.min(failures - 1, 5)));
        waitFiber = yield* Effect.fork(
          runListenerCommand(instance, paseoChatWaitArgs(roomId, instance.host)),
        );
        continue;
      }
      const reconciledRows = yield* Effect.either(
        parsePaseoChatMessagesEffect(reconciled.right.stdout),
      );
      if (Either.isLeft(reconciledRows)) {
        yield* Fiber.interrupt(nextWaitFiber);
        failures += 1;
        yield* Effect.sleep(Math.min(30_000, RETRY_DELAY_MS * 2 ** Math.min(failures - 1, 5)));
        waitFiber = yield* Effect.fork(
          runListenerCommand(instance, paseoChatWaitArgs(roomId, instance.host)),
        );
        continue;
      }
      const reconciledImport = yield* Effect.either(
        Effect.tryPromise(() => importMessages(sessionId, reconciledRows.right, "live")),
      );
      if (Either.isLeft(reconciledImport)) {
        yield* Fiber.interrupt(nextWaitFiber);
        failures += 1;
        yield* Effect.sleep(Math.min(30_000, RETRY_DELAY_MS * 2 ** Math.min(failures - 1, 5)));
        waitFiber = yield* Effect.fork(
          runListenerCommand(instance, paseoChatWaitArgs(roomId, instance.host)),
        );
        continue;
      }
      waitFiber = nextWaitFiber;
      failures = 0;
    }
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() =>
        console.error("[paseo-chat] listener stopped for " + sessionId + ":", error),
      ),
    ),
  );
}

export function startPaseoChatListener(sessionId: string): void {
  if (detectSessionBackend(sessionId) !== "paseo-chat" || activeListeners.has(sessionId)) return;
  const fiber = Effect.runFork(
    listenerEffect(sessionId).pipe(
      Effect.ensuring(Effect.sync(() => activeListeners.delete(sessionId))),
    ),
  );
  activeListeners.set(sessionId, fiber);
}

export function stopPaseoChatListener(sessionId: string): void {
  const fiber = activeListeners.get(sessionId);
  if (!fiber) return;
  Effect.runFork(Fiber.interrupt(fiber));
  activeListeners.delete(sessionId);
}

registerPaseoChatListenerStarter(startPaseoChatListener);
registerPaseoChatListenerStopper(stopPaseoChatListener);

export function resumePaseoChatListeners(): void {
  for (const session of listSessions()) {
    if (session.backend === "paseo-chat" && session.state !== "archived") {
      startPaseoChatListener(session.id);
    }
  }
}

export function stopAllPaseoChatListeners(): void {
  for (const sessionId of activeListeners.keys()) stopPaseoChatListener(sessionId);
}
