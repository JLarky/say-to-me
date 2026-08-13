import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import stylex from "@stylexjs/unplugin";
import solid from "vite-plugin-solid";

try {
  process.loadEnvFile?.();
} catch (error) {
  if (!error || error.code !== "ENOENT") throw error;
}

const stableAllowedHosts = ["say.local", "say.localhost"];

const portlessAllowedHosts = [
  ...stableAllowedHosts,
  process.env.SAY_TO_ME_TAILSCALE_HOST,
  process.env.PORTLESS_URL,
  process.env.PORTLESS_TAILSCALE_URL,
].flatMap((url) => {
  if (!url) return [];
  try {
    return [new URL(url).hostname];
  } catch {
    return [url];
  }
});

const solidEmbedInclude = [/\/server\/embed\/solid\/.*\.tsx$/];

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react({ exclude: solidEmbedInclude })],
  server: {
    port: 5411,
  },
  vite: {
    plugins: [
      stylex.vite({ useCSSLayers: true }),
      solid({
        include: solidEmbedInclude,
      }),
    ],
    server: {
      allowedHosts: portlessAllowedHosts,
      watch: {
        ignored: ["**/.local/**"],
      },
    },
  },
});
