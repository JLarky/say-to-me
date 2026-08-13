import { Effect } from "effect";
import type { DbSession } from "./db/schemas.ts";
import { importExternalCliSessionIfKnown } from "./external-cli/resolve-provider.ts";
import { importOpenCodeSessionIfKnown } from "./opencode/client.ts";
import { detectSessionBackend } from "./session-id.ts";
import {
  importNotFoundError,
  type ImportNotFoundError,
  type ImportUpstreamError,
} from "./session-import-error.ts";
import { importT3SessionIfKnown } from "./t3/import.ts";
import { importPaseoChatIfKnown, importPaseoSessionIfKnown } from "./paseo/import.ts";

// Verifies a session id against its backend's own source of truth (OpenCode's
// live API, a Claude/Cursor/Codex/Grok local transcript, or a T3 shell thread)
// before creating a row for it. Unlike option 1, this is only ever invoked
// from an explicit user action (see /api/sessions/:sessionId/import), never
// as a side effect of posting a message or loading a session page.
export function importSessionIfKnown(
  sessionId: string,
  instanceId?: string,
): Effect.Effect<DbSession, ImportNotFoundError | ImportUpstreamError> {
  const backend = detectSessionBackend(sessionId);
  switch (backend) {
    case "opencode":
      return importOpenCodeSessionIfKnown(sessionId);
    case "claude":
    case "cursor":
    case "codex":
    case "grok":
      return importExternalCliSessionIfKnown(sessionId);
    case "t3":
      return importT3SessionIfKnown(sessionId, instanceId);
    case "paseo":
      return importPaseoSessionIfKnown(sessionId, instanceId);
    case "paseo-chat":
      return importPaseoChatIfKnown(sessionId, instanceId);
    case "voice":
    case "none":
      return Effect.fail(importNotFoundError(sessionId));
  }
}
