import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { getSession } from "../sessions.ts";
import { grokSessionDir } from "./delivery.ts";

const GROK_CONFIG = path.join(homedir(), ".grok", "config.toml");
const GROK_PROVIDER = "xai";

const GrokSummary = arktype({
  "current_model_id?": "string",
});

const GrokSignals = arktype({
  "primaryModelId?": "string",
});

function parseGrokConfig(raw: string): string | null {
  const sectionMatch = raw.match(/\[models\]([^[]*)/);
  if (!sectionMatch) return null;
  const re = /^default\s*=\s*"([^"]*)"/m;
  const match = sectionMatch[1].match(re);
  return match ? match[1] : null;
}

function parseGrokModelsOutput(output: string): string | null {
  for (const line of output.split("\n")) {
    if (line.includes("(default)")) {
      const m = line.trim().match(/[\s*-]+\s*(\S+)/);
      if (m) return m[1];
    }
  }
  return null;
}

/** Global Grok default (config / CLI list). Not for per-session Reset. */
export function readGrokCurrentModel(): { providerID: string; modelID: string } | null {
  try {
    if (existsSync(GROK_CONFIG)) {
      const raw = readFileSync(GROK_CONFIG, "utf-8");
      const modelId = parseGrokConfig(raw);
      if (modelId) return { providerID: GROK_PROVIDER, modelID: modelId };
    }
    const output = execSync("grok models", { encoding: "utf-8", timeout: 15000 });
    const modelId = parseGrokModelsOutput(output);
    if (modelId) return { providerID: GROK_PROVIDER, modelID: modelId };
    return null;
  } catch {
    return null;
  }
}

export function parseGrokSessionSummaryModel(raw: string): string | null {
  const parsed = safeJsonParse(GrokSummary, raw);
  const id = parsed?.current_model_id?.trim();
  return id || null;
}

export function parseGrokSessionSignalsModel(raw: string): string | null {
  const parsed = safeJsonParse(GrokSignals, raw);
  const id = parsed?.primaryModelId?.trim();
  return id || null;
}

/**
 * Model this Grok session is using right now (provider state on disk).
 * Prefer summary.current_model_id, then signals.primaryModelId.
 */
export function readGrokSessionModel(
  sessionId: string,
): { providerID: string; modelID: string } | null {
  const session = getSession(sessionId);
  const cwd = session?.cwd?.trim();
  if (!cwd) return null;
  const dir = grokSessionDir(cwd, sessionId);
  try {
    const summaryPath = path.join(dir, "summary.json");
    if (existsSync(summaryPath)) {
      const modelID = parseGrokSessionSummaryModel(readFileSync(summaryPath, "utf-8"));
      if (modelID) return { providerID: GROK_PROVIDER, modelID };
    }
    const signalsPath = path.join(dir, "signals.json");
    if (existsSync(signalsPath)) {
      const modelID = parseGrokSessionSignalsModel(readFileSync(signalsPath, "utf-8"));
      if (modelID) return { providerID: GROK_PROVIDER, modelID };
    }
  } catch {
    return null;
  }
  return null;
}
