import { Effect } from "effect";

import type { DbSession } from "../db/schemas.ts";
import {
  ensureSession,
  getSession,
  setSessionAliasIfSafe,
  setSessionCwd,
  setSessionT3InstanceId,
} from "../sessions.ts";
import {
  importNotFoundError,
  importUpstreamError,
  type ImportNotFoundError,
  type ImportUpstreamError,
} from "../session-import-error.ts";
import { toT3SessionId } from "../session-id.ts";
import { findT3ThreadAcrossInstancesEffect } from "./client.ts";

/**
 * Import a T3 thread as a Say To Me session (`t3_<threadUuid>`).
 * Verifies the thread still exists on a configured T3 instance shell snapshot.
 */
export function importT3SessionIfKnown(
  sessionId: string,
  instanceId?: string,
): Effect.Effect<DbSession, ImportNotFoundError | ImportUpstreamError> {
  const id = toT3SessionId(sessionId);
  if (!id) return Effect.fail(importNotFoundError(sessionId));
  const knownInstanceId = instanceId ?? getSession(id)?.t3InstanceId ?? undefined;
  const lookup = findT3ThreadAcrossInstancesEffect(id, knownInstanceId).pipe(
    Effect.mapError((cause) => importUpstreamError(sessionId, cause.message)),
  );
  return Effect.gen(function* () {
    const found = yield* lookup;
    if (!found) return yield* Effect.fail(importNotFoundError(sessionId));

    const cwd = found.thread.worktreePath?.trim() || found.project?.workspaceRoot?.trim() || null;
    ensureSession(id);
    setSessionT3InstanceId(id, found.instance.id);
    if (cwd) setSessionCwd(id, cwd);
    if (found.thread.title?.trim()) {
      setSessionAliasIfSafe(id, found.thread.title.trim());
    }
    return ensureSession(id);
  });
}
