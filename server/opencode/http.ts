import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { Agent, fetch as undiciFetch } from "undici";
import { portlessCaPem } from "../external-cli/portless-ca.ts";

const fallbackOpenCodeUrl = "http://localhost:4096";

let httpsAgent: Agent | null = null;

export function openCodeBaseUrl(baseUrl = process.env.SAY_TO_ME_OPENCODE_URL): string {
  return baseUrl || fallbackOpenCodeUrl;
}

function openCodeHttpsAgent(): Agent | null {
  if (httpsAgent) return httpsAgent;
  const ca = portlessCaPem();
  if (!ca) return null;
  httpsAgent = new Agent({ connect: { ca } });
  return httpsAgent;
}

export async function openCodeFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  if (new URL(url).protocol === "https:") {
    const agent = openCodeHttpsAgent();
    if (agent) {
      const requestInit =
        input instanceof Request
          ? {
              body: input.body,
              duplex: input.body ? "half" : undefined,
              headers: input.headers,
              method: input.method,
              redirect: input.redirect,
              signal: input.signal,
              ...init,
            }
          : init;
      const response = await undiciFetch(url, {
        ...requestInit,
        dispatcher: agent,
      } as Parameters<typeof undiciFetch>[1]);
      // @ts-expect-error SAFETY: Undici implements the Fetch Response contract returned by this local HTTPS adapter.
      return response as Response;
    }
  }
  return fetch(input, init);
}

export function createOpenCodeClient(
  baseUrl = openCodeBaseUrl(),
  fetchImplementation = openCodeFetch,
) {
  return createOpencodeClient({ baseUrl, fetch: fetchImplementation });
}
