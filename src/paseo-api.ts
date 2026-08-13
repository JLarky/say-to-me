import { safeResponseJson } from "@say-to-me/runtime-validation";
import { type } from "arktype";

const InstancesPayload = type({ instances: type({ id: "string", label: "string" }).array() });
const DiscoverPayload = type({
  instanceId: "string",
  sessions: type({
    sessionId: "string",
    chatId: "string",
    title: "string | null",
    modifiedAt: "number | null",
    imported: "boolean",
    instanceId: "string",
    cwd: "string | null",
  }).array(),
});
export type PaseoImportSession = (typeof DiscoverPayload.infer)["sessions"][number];
export type PaseoImportInstance = (typeof InstancesPayload.infer)["instances"][number];
export const unclaimedPaseoImportSessions = (sessions: PaseoImportSession[]) =>
  sessions.filter((session) => !session.imported);

export async function listPaseoImportInstances(
  signal?: AbortSignal,
): Promise<PaseoImportInstance[]> {
  const response = await fetch("/api/paseo/instances", { signal });
  const payload = await safeResponseJson(response, InstancesPayload);
  if (!response.ok) throw new Error("Unable to list configured Paseo instances.");
  return payload.instances;
}

export async function discoverPaseoImportSessions(
  workspacePath: string,
  signal?: AbortSignal,
): Promise<PaseoImportSession[]> {
  const instances = await listPaseoImportInstances(signal);
  const results = await Promise.allSettled(
    instances.map(async (instance) => {
      const params = new URLSearchParams({ instanceId: instance.id, path: workspacePath });
      const response = await fetch(`/api/paseo/discover?${params.toString()}`, { signal });
      const payload = await safeResponseJson(response, DiscoverPayload);
      if (!response.ok) throw new Error(`Unable to scan ${instance.label}.`);
      return payload.sessions;
    }),
  );
  const sessions = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (
    results.length &&
    !sessions.length &&
    results.every((result) => result.status === "rejected")
  ) {
    throw new Error("Unable to scan configured Paseo instances.");
  }
  return sessions;
}
