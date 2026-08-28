import { describe, expect, it } from "vite-plus/test";
import {
  booWorkerNameForSession,
  isNonLiveAgentCliOrigin,
  resolveAgentCliServerUrl,
  resolveWorkerInternalUrl,
} from "./worker-internal-url.ts";

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

describe("isNonLiveAgentCliOrigin", () => {
  it("treats say.local and live 5411 as live", () => {
    expect(isNonLiveAgentCliOrigin("https://say.local:1355")).toBe(false);
    expect(isNonLiveAgentCliOrigin("http://127.0.0.1:5411")).toBe(false);
    expect(isNonLiveAgentCliOrigin("http://127.0.0.1:1")).toBe(true);
  });

  it("treats isolated loopback ports as non-live", () => {
    expect(isNonLiveAgentCliOrigin("http://127.0.0.1:5412")).toBe(true);
    expect(isNonLiveAgentCliOrigin("http://127.0.0.1:5416")).toBe(true);
  });
});

describe("resolveAgentCliServerUrl", () => {
  it("returns isolated SAY_TO_ME_URL", () => {
    expect(
      resolveAgentCliServerUrl({
        env: { SAY_TO_ME_URL: "http://127.0.0.1:5412" },
        existsSync: () => false,
        readFileSync: () => {
          throw new Error("should not read");
        },
      }),
    ).toBe("http://127.0.0.1:5412");
  });

  it("returns null for live say.local / 5411", () => {
    expect(
      resolveAgentCliServerUrl({
        env: { SAY_TO_ME_URL: "https://say.local:1355" },
        existsSync: () => false,
        readFileSync: () => {
          throw new Error("should not read");
        },
      }),
    ).toBe(null);
    expect(
      resolveAgentCliServerUrl({
        env: {
          SAY_TO_ME_URL: "http://localhost:5411",
          SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5412",
        },
        existsSync: () => false,
        readFileSync: () => {
          throw new Error("should not read");
        },
      }),
    ).toBe(null);
    expect(
      resolveAgentCliServerUrl({
        env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5411" },
        existsSync: () => false,
        readFileSync: () => {
          throw new Error("should not read");
        },
      }),
    ).toBe(null);
  });
});

describe("booWorkerNameForSession", () => {
  it("keeps stm-<id> on live 5411 / say.local", () => {
    expect(
      booWorkerNameForSession("cur_abc", {
        env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5411" },
        existsSync: () => false,
        readFileSync: () => {
          throw new Error("should not read");
        },
      }),
    ).toBe("stm-cur_abc");
    expect(
      booWorkerNameForSession("cur_abc", {
        env: { SAY_TO_ME_INTERNAL_URL: "https://say.local:1355" },
        existsSync: () => false,
        readFileSync: () => {
          throw new Error("should not read");
        },
      }),
    ).toBe("stm-cur_abc");
  });

  it("prefixes isolated ports as stm_<port>_<id>", () => {
    expect(
      booWorkerNameForSession("cur_abc", {
        env: { SAY_TO_ME_INTERNAL_URL: "http://127.0.0.1:5412" },
        existsSync: () => false,
        readFileSync: () => {
          throw new Error("should not read");
        },
      }),
    ).toBe("stm_5412_cur_abc");
  });
});
