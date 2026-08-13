// Shared tagged error for the session-import chain (server/session-import.ts,
// server/opencode/client.ts, server/external-cli/resolve-provider.ts). Kept in
// its own file so those modules can share the error type without importing
// each other.
export type ImportNotFoundError = {
  readonly _tag: "ImportNotFoundError";
  readonly sessionId: string;
};

export type ImportUpstreamError = {
  readonly _tag: "ImportUpstreamError";
  readonly sessionId: string;
  readonly error: string;
};

export function importNotFoundError(sessionId: string): ImportNotFoundError {
  return { _tag: "ImportNotFoundError", sessionId };
}

export function importUpstreamError(sessionId: string, error: string): ImportUpstreamError {
  return { _tag: "ImportUpstreamError", sessionId, error };
}
