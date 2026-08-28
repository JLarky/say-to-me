import { describe, expect, it } from "vite-plus/test";
import { resolveWorkerInternalUrl } from "./worker-internal-url.ts";

describe("resolveWorkerInternalUrl", () => {
  it("prefers this process Astro loopback when INTERNAL_URL is shared say.local", () => {
    const url = resolveWorkerInternalUrl({
      cwd: "/worktree",
      env: { SAY_TO_ME_INTERNAL_URL: "https://say.local:1355" },
      existsSync: (filePath) => filePath.endsWith(".astro/dev.json"),
      readFileSync: () => JSON.stringify({ port: 5416, url: "http://localhost:5416" }),
    });
    expect(url).toBe("http://127.0.0.1:5416");
  });

  it("keeps an explicit loopback INTERNAL_URL (tests / isolated servers)", () => {
    const url = resolveWorkerInternalUrl({
      cwd: "/worktree",
      env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:9876" },
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ port: 5416 }),
    });
    expect(url).toBe("http://127.0.0.1:9876");
  });

  it("falls back to say.local when no Astro dev metadata exists", () => {
    const url = resolveWorkerInternalUrl({
      cwd: "/worktree",
      env: {},
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("should not read");
      },
    });
    expect(url).toBe("https://say.local:1355");
  });

  it("falls back to configured URL when existsSync is true but readFileSync throws", () => {
    const url = resolveWorkerInternalUrl({
      cwd: "/worktree",
      env: { SAY_TO_ME_INTERNAL_URL: "https://say.local:1355" },
      existsSync: () => true,
      readFileSync: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    expect(url).toBe("https://say.local:1355");
  });
});
