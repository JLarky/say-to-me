import { describe, expect, it } from "vite-plus/test";
import { serverCapabilities } from "./capabilities.ts";

describe("serverCapabilities", () => {
  it("omits the OpenCode directory link token when no base URL is configured", () => {
    expect(
      serverCapabilities({
        enableOpenCodeActivityPreview: true,
        env: {},
        opencodeDirectory: "/repo",
      }),
    ).toEqual({
      openCodeActivityPreview: true,
      opencodeDirB64: null,
      opencodeLocalBase: null,
      opencodeTailscaleBase: null,
      paseoLocalBase: null,
      paseoTailscaleBase: null,
    });
  });

  it("includes configured OpenCode bases and base64url-encodes the directory", () => {
    expect(
      serverCapabilities({
        enableOpenCodeActivityPreview: false,
        env: {
          SAY_TO_ME_OPENCODE_LOCAL_URL: "https://opencode.local:1355",
          SAY_TO_ME_OPENCODE_TAILSCALE_URL: "https://tail.example.ts.net",
          SAY_TO_ME_PASEO_LOCAL_URL: "http://localhost:6767",
          SAY_TO_ME_PASEO_TAILSCALE_URL: "https://paseo.example.ts.net",
        },
        opencodeDirectory: "/workspace/project",
      }),
    ).toEqual({
      openCodeActivityPreview: false,
      opencodeDirB64: "L3dvcmtzcGFjZS9wcm9qZWN0",
      opencodeLocalBase: "https://opencode.local:1355",
      opencodeTailscaleBase: "https://tail.example.ts.net",
      paseoLocalBase: "http://localhost:6767",
      paseoTailscaleBase: "https://paseo.example.ts.net",
    });
  });
});
