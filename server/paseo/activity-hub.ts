import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { createActivityHub, type ActivityListener } from "../activityHub.ts";
import {
  EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT,
  EXTERNAL_CLI_ACTIVITY_MAX_LIMIT,
  limitExternalCliActivitySnapshot,
  type ExternalCliActivitySnapshot,
} from "../external-cli/activity-hub.ts";
import { detectSessionBackend, paseoSessionUuid } from "../session-id.ts";
import { getSession } from "../sessions.ts";
import { getPaseoInstance } from "../settings.ts";
import { parsePaseoActivity, type PaseoActivityItem } from "./activity.ts";
import { runPaseoCommand } from "./client.ts";

export const PASEO_ACTIVITY_DEFAULT_LIMIT = EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT;
export const PASEO_ACTIVITY_MAX_LIMIT = EXTERNAL_CLI_ACTIVITY_MAX_LIMIT;

export type PaseoActivitySnapshot = ExternalCliActivitySnapshot<PaseoActivityItem>;

const PaseoInspectStatus = arktype({ "Status?": "string | null" });

function parseInspectStatus(stdout: string): string | null {
  const parsed = safeJsonParse(PaseoInspectStatus, stdout.trim());
  return parsed?.Status ?? null;
}

async function fetchPaseoActivitySnapshot(sessionId: string): Promise<PaseoActivitySnapshot> {
  if (detectSessionBackend(sessionId) !== "paseo") throw new Error("Not a Paseo session.");
  const instanceId = getSession(sessionId)?.paseoInstanceId?.trim();
  const instance = instanceId ? getPaseoInstance(instanceId) : null;
  if (!instance) throw new Error(`Paseo session "${sessionId}" has no configured instance.`);

  const uuid = paseoSessionUuid(sessionId);
  const [logsResult, inspectResult] = await Promise.all([
    runPaseoCommand(instance, [
      "logs",
      uuid,
      "--tail",
      String(EXTERNAL_CLI_ACTIVITY_MAX_LIMIT),
      "--host",
      instance.host,
    ]),
    runPaseoCommand(instance, ["inspect", uuid, "--json", "--host", instance.host]),
  ]);

  const { items, lastTimestamp } = parsePaseoActivity(
    logsResult.stdout,
    EXTERNAL_CLI_ACTIVITY_MAX_LIMIT,
  );
  const busy = parseInspectStatus(inspectResult.stdout) === "running";
  return { items, lastTimestamp, busy, status: busy ? "busy" : "idle" };
}

const paseoActivityHub = createActivityHub<PaseoActivitySnapshot>({
  fetchSnapshot: fetchPaseoActivitySnapshot,
  // paseo logs/inspect shell out to the daemon on every poll, unlike the
  // local-file-tailing CLI hubs — poll a bit less aggressively than their 2500ms.
  pollIntervalMs: 3000,
  isActiveSnapshot: (snapshot) => snapshot.status === "busy",
});

export function shutdownPaseoActivityHub(): void {
  paseoActivityHub.shutdown();
}

export async function getPaseoActivitySnapshot(
  sessionId: string,
  limit = PASEO_ACTIVITY_DEFAULT_LIMIT,
): Promise<PaseoActivitySnapshot> {
  const snapshot = await paseoActivityHub.snapshot(sessionId);
  return limitExternalCliActivitySnapshot(snapshot, limit);
}

function paseoRejectionMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function subscribePaseoActivity(
  sessionId: string,
  limit: number,
  listener: ActivityListener<PaseoActivitySnapshot>,
): () => void {
  const limitedListener: ActivityListener<PaseoActivitySnapshot> = {
    onSnapshot: (snapshot) =>
      listener.onSnapshot(limitExternalCliActivitySnapshot(snapshot, limit)),
    onError: listener.onError,
  };
  const unsubscribe = paseoActivityHub.subscribe(sessionId, limitedListener);
  void paseoActivityHub
    .snapshot(sessionId)
    .then(limitedListener.onSnapshot, (caught) =>
      limitedListener.onError(paseoRejectionMessage(caught)),
    );
  return unsubscribe;
}
