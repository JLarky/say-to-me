import { getPaseoInstance, type PaseoInstance } from "../settings.ts";

function paseoWebOrigin(host: string): string {
  const value = host.trim();
  if (/^https?:\/\//i.test(value)) return new URL(value).origin;
  if (/^tcp:\/\//i.test(value)) return `http://${new URL(value).host}`;
  return `http://${value.split("?")[0]}`;
}

export function paseoParkUrl(
  instance: Pick<PaseoInstance, "id" | "host">,
  threadId: string,
): string {
  const url = new URL("/park.html", paseoWebOrigin(instance.host));
  url.searchParams.set("environmentId", instance.id);
  url.searchParams.set("threadId", threadId);
  return url.toString();
}

export function paseoUiUrlForSession(session: {
  id: string;
  paseoInstanceId?: string | null;
}): string | null {
  if (!session.id.startsWith("pa_") || !session.paseoInstanceId) return null;
  const instance = getPaseoInstance(session.paseoInstanceId);
  return instance ? paseoParkUrl(instance, session.id.slice(3)) : null;
}
