import { type as arktype } from "arktype";
import { safeResponseJson } from "@say-to-me/runtime-validation";

export const DEFAULT_WORKTREE_PARENT_PATH = "~/.say-to-me/workspaces";
export const DEFAULT_JARVIS_PARENT_PATH = "~/.say-to-me/jarvis";
export const DEFAULT_T3_SERVER_INSTANCE_ID = "default";
export const DEFAULT_T3_SERVER_ORIGIN_URL = "http://localhost:5470/";
export const DEFAULT_PASEO_INSTANCE_ID = "default";
export const DEFAULT_PASEO_HOST = "127.0.0.1:6767";

const T3ServerInstance = arktype({
  id: "string",
  "binPath?": "string",
  baseDir: "string",
  originUrl: "string",
  isDev: "boolean",
});
const PaseoInstance = arktype({
  id: "string",
  "binPath?": "string",
  "home?": "string",
  host: "string",
});
const OpenCodeInstance = arktype({
  id: "string",
  "localUrl?": "string",
  "tailscaleUrl?": "string",
});

const SettingsResponse = arktype({
  preferredWorktreeParentPath: "string | null",
  preferredJarvisParentPath: "string | null",
  t3ServerInstances: T3ServerInstance.array(),
  paseoInstances: PaseoInstance.array(),
  "opencodeInstances?": OpenCodeInstance.array(),
});
const SettingsErrorResponse = arktype({ error: "string" });

export type T3ServerInstance = typeof T3ServerInstance.infer;
export type PaseoInstance = typeof PaseoInstance.infer;
export type OpenCodeInstance = typeof OpenCodeInstance.infer;
export type AppSettings = typeof SettingsResponse.infer;

export type AppSettingsPatch = {
  preferredWorktreeParentPath?: string | null;
  preferredJarvisParentPath?: string | null;
  t3ServerInstances?: T3ServerInstance[];
  paseoInstances?: PaseoInstance[];
  opencodeInstances?: OpenCodeInstance[];
};

export function displayLocationPath(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

export function createEmptyT3ServerInstance(
  overrides: Partial<T3ServerInstance> = {},
): T3ServerInstance {
  return {
    id: DEFAULT_T3_SERVER_INSTANCE_ID,
    binPath: "",
    baseDir: "",
    originUrl: DEFAULT_T3_SERVER_ORIGIN_URL,
    isDev: false,
    ...overrides,
  };
}

export function createEmptyPaseoInstance(overrides: Partial<PaseoInstance> = {}): PaseoInstance {
  return {
    id: DEFAULT_PASEO_INSTANCE_ID,
    binPath: "",
    home: "",
    host: DEFAULT_PASEO_HOST,
    ...overrides,
  };
}

async function request(init?: RequestInit): Promise<AppSettings> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  const response = await fetch("/api/settings", { ...init, headers });
  if (!response.ok) {
    let message = `Settings request failed (${response.status}).`;
    try {
      message = (await safeResponseJson(response, SettingsErrorResponse)).error;
    } catch {
      // Keep the HTTP status message when an error response is malformed.
    }
    throw new Error(message);
  }
  return safeResponseJson(response, SettingsResponse);
}

export function fetchSettings(): Promise<AppSettings> {
  return request();
}

export function updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  return request({
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
