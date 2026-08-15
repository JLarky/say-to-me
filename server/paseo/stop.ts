import { isPaseoSessionId, paseoSessionUuid } from "../session-id.ts";
import { getSession } from "../sessions.ts";
import { getPaseoInstance } from "../settings.ts";
import { runPaseoCommand } from "./client.ts";

export type StopPaseoResult = { ok: true } | { ok: false; status: number; error: string };

export async function stopPaseoSession(sessionId: string): Promise<StopPaseoResult> {
  if (!isPaseoSessionId(sessionId)) {
    return { ok: false, status: 400, error: "Invalid Paseo session id." };
  }
  const instanceId = getSession(sessionId)?.paseoInstanceId?.trim();
  const instance = instanceId ? getPaseoInstance(instanceId) : null;
  if (!instance) return { ok: false, status: 404, error: "Paseo instance is unavailable." };
  try {
    await runPaseoCommand(instance, [
      "stop",
      paseoSessionUuid(sessionId),
      "--json",
      "--host",
      instance.host,
    ]);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
