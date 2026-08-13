import { describe, expect, it } from "vite-plus/test";
import {
  autostartWorkerMode,
  isRealWorkerMode,
  sessionIdRequestField,
  workerMode,
  workerModeEnvName,
} from "./worker-env.ts";

describe("external-cli worker-env", () => {
  it("defaults hand-run worker mode to echo when unset", () => {
    const prevClaude = process.env.SAY_TO_ME_CLAUDE_WORKER_MODE;
    const prevCursor = process.env.SAY_TO_ME_CURSOR_WORKER_MODE;
    delete process.env.SAY_TO_ME_CLAUDE_WORKER_MODE;
    delete process.env.SAY_TO_ME_CURSOR_WORKER_MODE;
    try {
      expect(workerMode("CLAUDE")).toBe("echo");
      expect(workerMode("CURSOR")).toBe("echo");
      expect(isRealWorkerMode("CLAUDE", "claude")).toBe(false);
      expect(isRealWorkerMode("CURSOR", "cursor")).toBe(false);
    } finally {
      if (prevClaude === undefined) delete process.env.SAY_TO_ME_CLAUDE_WORKER_MODE;
      else process.env.SAY_TO_ME_CLAUDE_WORKER_MODE = prevClaude;
      if (prevCursor === undefined) delete process.env.SAY_TO_ME_CURSOR_WORKER_MODE;
      else process.env.SAY_TO_ME_CURSOR_WORKER_MODE = prevCursor;
    }
  });

  it("derives worker mode env names from the backend prefix", () => {
    expect(workerModeEnvName("CLAUDE")).toBe("SAY_TO_ME_CLAUDE_WORKER_MODE");
    expect(workerModeEnvName("CURSOR")).toBe("SAY_TO_ME_CURSOR_WORKER_MODE");
    expect(workerModeEnvName("CODEX")).toBe("SAY_TO_ME_CODEX_WORKER_MODE");
  });

  it("derives session id request fields from the backend prefix", () => {
    expect(sessionIdRequestField("CLAUDE")).toBe("claudeSessionId");
    expect(sessionIdRequestField("CURSOR")).toBe("cursorSessionId");
    expect(sessionIdRequestField("CODEX")).toBe("codexSessionId");
  });

  it("defaults boo autostart to the real backend when unset", () => {
    const prevClaude = process.env.SAY_TO_ME_CLAUDE_WORKER_MODE;
    delete process.env.SAY_TO_ME_CLAUDE_WORKER_MODE;
    try {
      expect(autostartWorkerMode("CLAUDE", "claude")).toBe("claude");
      expect(autostartWorkerMode("CURSOR", "cursor")).toBe("cursor");
    } finally {
      if (prevClaude === undefined) delete process.env.SAY_TO_ME_CLAUDE_WORKER_MODE;
      else process.env.SAY_TO_ME_CLAUDE_WORKER_MODE = prevClaude;
    }
  });
});
