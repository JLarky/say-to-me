import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { codexSessionJsonlPath } from "./resolve.ts";
import { codexSessionUuid } from "../session-id.ts";

const CODEX_CONFIG = path.join(homedir(), ".codex", "config.toml");
const CODEX_PROVIDER = "openai";

const CodexModelLine = arktype({
  "type?": "string",
  "payload?": {
    "model?": "string",
    "model_provider?": "string",
    "model_provider_id?": "string",
    "thread_settings?": {
      "model?": "string",
      "model_provider_id?": "string",
    },
  },
});

function parseCodexConfig(raw: string): string | null {
  const re = /^model\s*=\s*"([^"]*)"/m;
  const match = raw.match(re);
  return match ? match[1] : null;
}

export function readCodexCurrentModel(): { providerID: string; modelID: string } | null {
  try {
    if (!existsSync(CODEX_CONFIG)) return null;
    const raw = readFileSync(CODEX_CONFIG, "utf-8");
    const modelId = parseCodexConfig(raw);
    if (modelId) return { providerID: CODEX_PROVIDER, modelID: modelId };
    return null;
  } catch {
    return null;
  }
}

export function parseCodexSessionLineModel(
  raw: string,
): { providerID: string | null; modelID: string | null } | null {
  const parsed = safeJsonParse(CodexModelLine, raw);
  if (!parsed?.payload) return null;
  const settings = parsed.payload.thread_settings;
  const modelID = (settings?.model || parsed.payload.model || "").trim();
  const providerID = (
    settings?.model_provider_id ||
    parsed.payload.model_provider_id ||
    parsed.payload.model_provider ||
    ""
  ).trim();
  if (!modelID && !providerID) return null;
  return {
    providerID: providerID || null,
    modelID: modelID || null,
  };
}

/**
 * Model recorded in this Codex session JSONL. Prefer latest settings/turn context
 * over global config so Reset reflects the actual resumed session model.
 */
export function readCodexSessionModel(
  sessionId: string,
): { providerID: string; modelID: string } | null {
  try {
    const sessionPath = codexSessionJsonlPath(codexSessionUuid(sessionId));
    if (!sessionPath) return null;
    let latestProvider = CODEX_PROVIDER;
    let latestModel: string | null = null;
    for (const line of readFileSync(sessionPath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      const entry = parseCodexSessionLineModel(line);
      if (!entry) continue;
      if (entry.providerID) latestProvider = entry.providerID;
      if (entry.modelID) latestModel = entry.modelID;
    }
    return latestModel ? { providerID: latestProvider, modelID: latestModel } : null;
  } catch {
    return null;
  }
}
