import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { getPaseoInstance, type PaseoInstance } from "../settings.ts";

function paseoWebOrigin(host: string): string {
  const value = host.trim();
  const origin = /^https?:\/\//i.test(value)
    ? new URL(value).origin
    : /^tcp:\/\//i.test(value)
      ? `http://${new URL(value).host}`
      : `http://${value.split("?")[0]}`;
  return origin.replace("127.0.0.1", "localhost");
}

function paseoServerId(instance: Pick<PaseoInstance, "home" | "serverId">): string | null {
  if (instance.serverId?.trim()) return instance.serverId.trim();
  const home = instance.home?.trim()
    ? instance.home.replace(/^~(?=\/|$)/, homedir())
    : path.join(homedir(), ".paseo");
  try {
    const serverId = readFileSync(path.join(home, "server-id"), "utf8").trim();
    return serverId || null;
  } catch {
    return null;
  }
}

export function paseoAgentUrl(
  instance: Pick<PaseoInstance, "id" | "host" | "home" | "serverId">,
  threadId: string,
  host = instance.host,
): string {
  const serverId = paseoServerId(instance);
  if (!serverId) throw new Error(`Paseo server ID is unavailable for instance "${instance.id}".`);
  return new URL(
    `/h/${serverId}/agent/${encodeURIComponent(threadId)}`,
    paseoWebOrigin(host),
  ).toString();
}

export function paseoUiUrlsForSession(session: {
  id: string;
  paseoInstanceId?: string | null;
}): { paseoUiUrl: string; paseoLocalUrl?: string; paseoTailscaleUrl?: string } | null {
  if (!session.id.startsWith("pa_") || !session.paseoInstanceId) return null;
  const instance = getPaseoInstance(session.paseoInstanceId);
  if (!instance) return null;
  try {
    const threadId = session.id.slice(3);
    const base = { paseoUiUrl: paseoAgentUrl(instance, threadId) };
    const withLocal = instance.localUrl
      ? { ...base, paseoLocalUrl: paseoAgentUrl(instance, threadId, instance.localUrl) }
      : base;
    return instance.tailscaleUrl
      ? {
          ...withLocal,
          paseoTailscaleUrl: paseoAgentUrl(instance, threadId, instance.tailscaleUrl),
        }
      : withLocal;
  } catch {
    return null;
  }
}

export function paseoUiUrlForSession(session: {
  id: string;
  paseoInstanceId?: string | null;
}): string | null {
  if (!session.id.startsWith("pa_") || !session.paseoInstanceId) return null;
  return paseoUiUrlsForSession(session)?.paseoUiUrl ?? null;
}
