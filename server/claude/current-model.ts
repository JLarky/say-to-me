import { type as arktype } from "arktype";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseJson } from "@say-to-me/runtime-validation";

const CLAUDE_CONFIG = path.join(homedir(), ".claude", "settings.json");

const ClaudeConfigModel = arktype({
  "model?": "string",
});

export function readClaudeCurrentModel(): { providerID: string; modelID: string } | null {
  try {
    if (!existsSync(CLAUDE_CONFIG)) return null;
    const raw = readFileSync(CLAUDE_CONFIG, "utf-8");
    const validated = parseJson(ClaudeConfigModel, raw);
    if (!validated.model) return null;
    return { providerID: "anthropic", modelID: validated.model };
  } catch {
    return null;
  }
}
