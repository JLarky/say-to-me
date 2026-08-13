import { isJarvisStatusPath, prettyJsonWebResponse } from "./jarvis-status.ts";
import {
  messageAttachmentHttpApiWebHandler,
  uploadAttachmentHttpApiWebHandler,
  uploadImageHttpApiWebHandler,
} from "./uploads.ts";
import { disposeSayToMeHttpApiHandler, sayToMeHttpApiWebHandler } from "./merged-api.ts";

async function dispatchUploadRequest(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (request.method === "POST" && pathname === "/api/uploads/image") {
    return uploadImageHttpApiWebHandler(request);
  }
  if (request.method === "POST" && pathname === "/api/uploads/attachment") {
    return uploadAttachmentHttpApiWebHandler(request);
  }
  if (request.method === "GET" && /^\/api\/message-attachments\/[^/]+$/.test(pathname)) {
    return messageAttachmentHttpApiWebHandler(request);
  }
  return null;
}

// The host-agnostic entry point for Effect JSON routes and uploads. Hand it any
// standard `Request` and it returns the route's `Response`, or `null` when no
// route matches (so the caller can fall through to SSE or a frontend renderer).
export async function dispatchEffectApiRequest(
  request: Request,
): Promise<globalThis.Response | null> {
  const uploadResponse = await dispatchUploadRequest(request);
  if (uploadResponse) return uploadResponse;

  const response = await sayToMeHttpApiWebHandler(request);
  if (response.status === 404) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body: unknown = await response.clone().json();
        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof (body as { error?: unknown }).error === "string"
        ) {
          return response;
        }
      } catch {
        // Unmatched routes may return non-JSON 404 bodies.
      }
    }
    return null;
  }

  const { pathname } = new URL(request.url);
  if (isJarvisStatusPath(pathname)) {
    return prettyJsonWebResponse(response);
  }

  return response;
}

export { disposeSayToMeHttpApiHandler };
