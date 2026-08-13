import { Agent, fetch as undiciFetch } from "undici";
import { internalApiToken } from "../claude/internal-api-token.ts";
import { type JsonSchema, safeResponseJson } from "@say-to-me/runtime-validation";
import { portlessCaPem } from "./portless-ca.ts";

const DEFAULT_INTERNAL_URL = "https://say.local:1355";

let httpsAgent: Agent | null = null;

export function internalBaseUrl(): string {
  return (process.env.SAY_TO_ME_INTERNAL_URL ?? DEFAULT_INTERNAL_URL).replace(/\/$/, "");
}

function httpsInternalAgent(): Agent | null {
  if (httpsAgent) return httpsAgent;
  const ca = portlessCaPem();
  if (!ca) return null;
  httpsAgent = new Agent({ connect: { ca } });
  return httpsAgent;
}

async function internalFetch(url: string, init: RequestInit): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol === "https:") {
    const agent = httpsInternalAgent();
    if (agent) {
      const response = await undiciFetch(url, {
        ...init,
        dispatcher: agent,
      } as Parameters<typeof undiciFetch>[1]);
      return response as unknown as Response;
    }
  }
  // Test plumbing only: production workers default to portless HTTPS.
  return fetch(url, init);
}

export async function postInternalJson<T>(
  path: string,
  body: unknown,
  schema: JsonSchema<T>,
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = internalApiToken();
  if (token) headers["x-say-to-me-internal-token"] = token;
  const response = await internalFetch(`${internalBaseUrl()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
  }
  return safeResponseJson(response, schema);
}
