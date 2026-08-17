/** Map an OpenCode SDK session.create result into a create failure payload. */
export type OpenCodeSessionCreateFailure = { ok: false; status: number; error: string };

export function mapOpenCodeSessionCreateFailure(result: {
  response?: { status: number } | null;
  error?: unknown;
}): OpenCodeSessionCreateFailure {
  // v2 SDK network failures can omit `response` entirely.
  if (!result.response) {
    return {
      ok: false,
      status: 502,
      error:
        result.error instanceof Error && result.error.message.trim()
          ? result.error.message
          : "OpenCode is unavailable. Start the OpenCode server and try again.",
    };
  }
  return {
    ok: false,
    status: result.response.status || 502,
    error: `OpenCode returned HTTP ${result.response.status}`,
  };
}
