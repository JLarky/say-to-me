import { Effect } from "effect";
import type { DbSession } from "../db/schemas.ts";
import { getAppSettings, type PaseoInstance } from "../settings.ts";
import {
  ensureSession,
  getSession,
  setSessionAliasIfSafe,
  setSessionCwd,
  setSessionPaseoInstanceId,
} from "../sessions.ts";
import {
  importNotFoundError,
  importUpstreamError,
  type ImportNotFoundError,
  type ImportUpstreamError,
} from "../session-import-error.ts";
import { paseoSessionUuid, toPaseoChatSessionId, toPaseoSessionId } from "../session-id.ts";
import { listPaseoChatRooms, listPaseoSessions, type PaseoDiscoverableSession } from "./client.ts";
import { startPaseoChatListener } from "./chat-listener.ts";

/**
 * Discovery errors are swallowed while scanning all instances (another instance
 * may still own the session) but surface as upstream errors when an owner is
 * already known.
 */
function importDiscoveredPaseoSession(
  sessionId: string,
  id: string,
  instanceId: string | undefined,
  findOnInstance: (instance: PaseoInstance) => Promise<PaseoDiscoverableSession | undefined>,
): Effect.Effect<DbSession, ImportNotFoundError | ImportUpstreamError> {
  const owner = instanceId ?? getSession(id)?.paseoInstanceId ?? undefined;
  return Effect.tryPromise({
    try: async (): Promise<DbSession | null> => {
      for (const instance of getAppSettings().paseoInstances) {
        if (owner && instance.id !== owner) continue;
        try {
          const found = await findOnInstance(instance);
          if (!found) continue;
          ensureSession(id);
          setSessionPaseoInstanceId(id, instance.id);
          if (found.cwd) setSessionCwd(id, found.cwd);
          if (found.title) setSessionAliasIfSafe(id, found.title);
          return ensureSession(id);
        } catch (error) {
          if (owner) throw error;
        }
      }
      return null;
    },
    catch: (cause) =>
      importUpstreamError(sessionId, cause instanceof Error ? cause.message : String(cause)),
  }).pipe(
    Effect.flatMap((found) =>
      found ? Effect.succeed(found) : Effect.fail(importNotFoundError(sessionId)),
    ),
  );
}

export function importPaseoSessionIfKnown(
  sessionId: string,
  instanceId?: string,
): Effect.Effect<DbSession, ImportNotFoundError | ImportUpstreamError> {
  const id = toPaseoSessionId(sessionId);
  if (!id) return Effect.fail(importNotFoundError(sessionId));
  return importDiscoveredPaseoSession(sessionId, id, instanceId, async (instance) =>
    (await listPaseoSessions(instance)).find((session) => session.chatId === paseoSessionUuid(id)),
  );
}

/** Import a Paseo chat room as a Say To Me session (`pc_<roomUuid>`). */
export function importPaseoChatIfKnown(
  sessionId: string,
  instanceId?: string,
): Effect.Effect<DbSession, ImportNotFoundError | ImportUpstreamError> {
  const id = toPaseoChatSessionId(sessionId);
  if (!id) return Effect.fail(importNotFoundError(sessionId));
  return importDiscoveredPaseoSession(sessionId, id, instanceId, async (instance) =>
    (await listPaseoChatRooms(instance)).find((session) => session.sessionId === id),
  ).pipe(Effect.tap(() => Effect.sync(() => startPaseoChatListener(id))));
}
