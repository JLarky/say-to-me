import { safeResponseJson } from "@say-to-me/runtime-validation";
import { type } from "arktype";

const ImportError = type({ "error?": "string" });

/** Same POST used by /sessions import and OpenSessionByIdForm (OpenCode path). */
export async function importSessionById(sessionId: string, instanceId?: string): Promise<void> {
  const query = instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : "";
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/import${query}`, {
    method: "POST",
  });
  if (response.ok) return;
  let message = "Unable to import session.";
  try {
    const payload = await safeResponseJson(response, ImportError);
    if (payload.error?.trim()) message = payload.error.trim();
  } catch {
    // keep fallback
  }
  throw new Error(message);
}

export function sessionHrefForId(sessionId: string): string {
  return sessionId === "default" ? "/default" : `/ses/${sessionId}`;
}
