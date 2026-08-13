import { dispatchApiRequest } from "./api-routes/dispatch-api-request.ts";
import { ensureHostRuntimeStarted } from "./host-runtime.ts";

export function isApiPath(pathname: string): boolean {
  return pathname === "/say" || pathname.startsWith("/api/");
}

export function jsonApiNotFoundResponse(): Response {
  return Response.json({ error: "Not found.", status: 404 }, { status: 404 });
}

export async function handleWebHostRequest(request: Request): Promise<Response | null> {
  ensureHostRuntimeStarted();
  const apiResponse = await dispatchApiRequest(request);
  if (apiResponse) return apiResponse;
  if (isApiPath(new URL(request.url).pathname)) return jsonApiNotFoundResponse();
  return null;
}

export function createWebHostHandler(
  frontendFallback: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const apiResponse = await handleWebHostRequest(request);
    return apiResponse ?? frontendFallback(request);
  };
}
