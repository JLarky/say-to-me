/** Session-list live transport: polling by default to free an HTTP/1.1 slot. */

export const SESSION_LIST_SSE_FLAG_KEY = "say-to-me:session-list-live-sse";
export const SESSION_LIST_POLL_MS = 3000;

/** Default is polling. Set localStorage to `"1"` or `?sessionListSse=1` to restore EventSource. */
export function isSessionListLiveSseEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(SESSION_LIST_SSE_FLAG_KEY) === "1") return true;
  } catch {
    // ignore
  }
  try {
    if (new URLSearchParams(window.location.search).get("sessionListSse") === "1") return true;
  } catch {
    // ignore
  }
  return false;
}
