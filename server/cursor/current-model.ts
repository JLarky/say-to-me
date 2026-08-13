import { type as arktype } from "arktype";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseJson } from "@say-to-me/runtime-validation";

const CURSOR_CONFIG = path.join(homedir(), ".cursor", "cli-config.json");

const CursorConfigModel = arktype({
  "model?": {
    "modelId?": "string",
    "displayModelId?": "string",
    "displayName?": "string",
  },
});

function modelIdFromCursorConfig(raw: string): string | null {
  try {
    const validated = parseJson(CursorConfigModel, raw);
    const model = validated.model;
    if (!model) return null;
    return model.displayModelId || model.modelId || null;
  } catch {
    return null;
  }
}

export function readCursorCurrentModel(): { providerID: string; modelID: string } | null {
  try {
    if (!existsSync(CURSOR_CONFIG)) return null;
    const raw = readFileSync(CURSOR_CONFIG, "utf-8");
    const modelID = modelIdFromCursorConfig(raw);
    if (modelID) return { providerID: "cursor", modelID };
    return null;
  } catch {
    return null;
  }
}
