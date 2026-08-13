import { safeResponseJson } from "@say-to-me/runtime-validation";
import { type } from "arktype";

const T3InstancesPayload = type({
  instances: type({ id: "string", label: "string" }).array(),
});

const T3DiscoverPayload = type({
  path: "string",
  instanceId: "string",
  sessions: type({
    sessionId: "string",
    chatId: "string",
    title: "string | null",
    modifiedAt: "number | null",
    imported: "boolean",
    instanceId: "string",
    projectId: "string",
    branch: "string | null",
    worktreePath: "string | null",
    workspaceRoot: "string | null",
  }).array(),
});

export type T3ImportSession = (typeof T3DiscoverPayload.infer)["sessions"][number];

export type T3ImportInstance = (typeof T3InstancesPayload.infer)["instances"][number];

export function unclaimedT3ImportSessions(sessions: T3ImportSession[]): T3ImportSession[] {
  return sessions.filter((session) => !session.imported);
}

export async function listT3ImportInstances(signal?: AbortSignal): Promise<T3ImportInstance[]> {
  const response = await fetch("/api/t3/instances", { signal });
  const payload = await safeResponseJson(response, T3InstancesPayload);
  if (!response.ok) throw new Error("Unable to list configured T3 instances.");
  return payload.instances;
}

export async function discoverT3ImportSessions(
  workspacePath: string,
  signal?: AbortSignal,
): Promise<T3ImportSession[]> {
  const instances = { instances: await listT3ImportInstances(signal) };

  const results = await Promise.allSettled(
    instances.instances.map(async (instance) => {
      const params = new URLSearchParams({ instanceId: instance.id, path: workspacePath });
      const response = await fetch(`/api/t3/discover?${params.toString()}`, { signal });
      const payload = await safeResponseJson(response, T3DiscoverPayload);
      if (!response.ok) throw new Error(`Unable to scan ${instance.label}.`);
      return payload.sessions;
    }),
  );
  const sessions = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (
    results.length > 0 &&
    sessions.length === 0 &&
    results.every((result) => result.status === "rejected")
  ) {
    throw new Error("Unable to scan configured T3 instances.");
  }
  return sessions;
}
