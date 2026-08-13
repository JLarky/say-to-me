import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load .env if present (Node 20.12+)
const envPath = path.join(root, ".env");
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // ignore if not supported
  }
}

export const dbPath = process.env.SAY_TO_ME_DB || path.join(root, ".local", "queue.sqlite");
export const dbDir = path.dirname(dbPath);
export const maxJsonBytes = Number(process.env.SAY_TO_ME_MAX_JSON_BYTES || 64 * 1024);
export const maxImageUploadBytes = Number(
  process.env.SAY_TO_ME_MAX_IMAGE_UPLOAD_BYTES || 10 * 1024 * 1024,
);
// Read live from env so isolate:false workers can restore production defaults in
// unit tests after the API harness sets tighter limits.
export const minMessageLength = () => Number(process.env.SAY_TO_ME_MIN_MESSAGE_LENGTH || 1);
export const maxMessageLength = () => Number(process.env.SAY_TO_ME_MAX_MESSAGE_LENGTH || 4000);
export const maxUserMessageLength = () =>
  Number(process.env.SAY_TO_ME_MAX_USER_MESSAGE_LENGTH || 32000);
/** Per-session cap on queued agent messages (not global). */
export const maxQueuedMessages = () => Number(process.env.SAY_TO_ME_MAX_QUEUED_MESSAGES || 70);
export const maxTotalMessages = () => Number(process.env.SAY_TO_ME_MAX_TOTAL_MESSAGES || 50);
export const opencodeStatusTimeoutMs = Number(
  process.env.SAY_TO_ME_OPENCODE_STATUS_TIMEOUT_MS || 1500,
);
export const opencodeDirectory = process.env.SAY_TO_ME_OPENCODE_DIRECTORY || root;
export const opencodeStatusCacheMs = Number(process.env.SAY_TO_ME_OPENCODE_STATUS_CACHE_MS || 2000);
export const opencodeTitleCacheMs = Number(process.env.SAY_TO_ME_OPENCODE_TITLE_CACHE_MS || 60_000);

// Single TTL for best-effort title extraction for the external CLI providers
// (Claude, Cursor, Codex, Grok). All four pull from local filesystem metadata.
export const externalCliTitleCacheMs = Number(
  process.env.SAY_TO_ME_EXTERNAL_CLI_TITLE_CACHE_MS ||
    process.env.SAY_TO_ME_CLAUDE_TITLE_CACHE_MS ||
    process.env.SAY_TO_ME_CURSOR_TITLE_CACHE_MS ||
    process.env.SAY_TO_ME_CODEX_TITLE_CACHE_MS ||
    process.env.SAY_TO_ME_GROK_TITLE_CACHE_MS ||
    60_000,
);

// Back-compat aliases (all resolve to the single external CLI value).
// Old per-provider env vars above are still honored via the fallback chain.
export const claudeTitleCacheMs = externalCliTitleCacheMs;
export const cursorTitleCacheMs = externalCliTitleCacheMs;
export const codexTitleCacheMs = externalCliTitleCacheMs;
export const grokTitleCacheMs = externalCliTitleCacheMs;
export const broadcastDebounceMs = Number(process.env.SAY_TO_ME_BROADCAST_DEBOUNCE_MS || 50);

// Risk guard for the stacked OpenCode activity preview/hub work. Enabled by
// default, but can be disabled quickly without reverting the stack.
export const enableOpenCodeActivityPreview =
  process.env.SAY_TO_ME_OPENCODE_ACTIVITY_PREVIEW !== "false";

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY;
export const vapidPrivateKey = () => process.env.VAPID_PRIVATE_KEY;
export const vapidSubject = () => process.env.VAPID_SUBJECT || "mailto:admin@localhost";
