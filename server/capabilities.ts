import type { OpenCodeInstance } from "./settings.ts";

export type ServerCapabilities = {
  openCodeActivityPreview: boolean;
  opencodeDirB64: string | null;
  opencodeLocalBase: string | null;
  opencodeTailscaleBase: string | null;
  paseoLocalBase: string | null;
  paseoTailscaleBase: string | null;
};

export function serverCapabilities({
  enableOpenCodeActivityPreview,
  env = process.env,
  opencodeDirectory,
  opencodeInstances,
}: {
  enableOpenCodeActivityPreview: boolean;
  env?: NodeJS.ProcessEnv;
  opencodeDirectory: string;
  opencodeInstances?: readonly OpenCodeInstance[];
}): ServerCapabilities {
  const configured = opencodeInstances?.find((instance) => instance.id === "default");
  const localUrl = configured?.localUrl || env.SAY_TO_ME_OPENCODE_LOCAL_URL || null;
  const tailscaleUrl = configured?.tailscaleUrl || env.SAY_TO_ME_OPENCODE_TAILSCALE_URL || null;
  const paseoLocalUrl = env.SAY_TO_ME_PASEO_LOCAL_URL || null;
  const paseoTailscaleUrl = env.SAY_TO_ME_PASEO_TAILSCALE_URL || null;
  const dirB64 = Buffer.from(opencodeDirectory).toString("base64url");

  return {
    openCodeActivityPreview: enableOpenCodeActivityPreview,
    opencodeDirB64: localUrl || tailscaleUrl ? dirB64 : null,
    opencodeLocalBase: localUrl,
    opencodeTailscaleBase: tailscaleUrl,
    paseoLocalBase: paseoLocalUrl,
    paseoTailscaleBase: paseoTailscaleUrl,
  };
}
