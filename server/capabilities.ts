export type ServerCapabilities = {
  openCodeActivityPreview: boolean;
  opencodeDirB64: string | null;
  opencodeLocalBase: string | null;
  opencodeTailscaleBase: string | null;
};

export function serverCapabilities({
  enableOpenCodeActivityPreview,
  env = process.env,
  opencodeDirectory,
}: {
  enableOpenCodeActivityPreview: boolean;
  env?: NodeJS.ProcessEnv;
  opencodeDirectory: string;
}): ServerCapabilities {
  const localUrl = env.SAY_TO_ME_OPENCODE_LOCAL_URL || null;
  const tailscaleUrl = env.SAY_TO_ME_OPENCODE_TAILSCALE_URL || null;
  const dirB64 = Buffer.from(opencodeDirectory).toString("base64url");

  return {
    openCodeActivityPreview: enableOpenCodeActivityPreview,
    opencodeDirB64: localUrl || tailscaleUrl ? dirB64 : null,
    opencodeLocalBase: localUrl,
    opencodeTailscaleBase: tailscaleUrl,
  };
}
