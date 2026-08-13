import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dbDir } from "../config.ts";

const tokenPath = path.join(dbDir, "internal-api-token");

export function internalApiTokenPath(): string {
  return tokenPath;
}

export function ensureInternalApiToken(): string {
  const fromEnv = process.env.SAY_TO_ME_INTERNAL_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(tokenPath)) {
    const persisted = readFileSync(tokenPath, "utf8").trim();
    if (persisted) {
      process.env.SAY_TO_ME_INTERNAL_API_TOKEN = persisted;
      return persisted;
    }
  }
  mkdirSync(dbDir, { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  process.env.SAY_TO_ME_INTERNAL_API_TOKEN = token;
  return token;
}

export function internalApiToken(): string | null {
  const fromEnv = process.env.SAY_TO_ME_INTERNAL_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(tokenPath)) return null;
  const persisted = readFileSync(tokenPath, "utf8").trim();
  return persisted || null;
}
