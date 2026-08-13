import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

const originalHome = process.env.HOME;
const testHome = mkdtempSync(path.join(tmpdir(), "session-context-home-"));
const testDbDir = mkdtempSync(path.join(tmpdir(), "session-context-db-"));
process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");
process.env.HOME = testHome;

const { getWorkspaceSessionContext } = await import("./session-context.ts");
const { ensureSession, setSessionCwd } = await import("../sessions.ts");

describe("getWorkspaceSessionContext", () => {
  beforeEach(() => {
    process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = testHome;
    process.env.HOME = testHome;
  });

  afterAll(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
  });
  it("reports path status and sessions at the workspace", () => {
    const repoCwd = mkdtempSync(path.join(testHome, "repo-"));
    const sessionId = "cc_b1b1b1b1-1111-4111-8111-111111111111";
    ensureSession(sessionId);
    setSessionCwd(sessionId, repoCwd);

    const result = getWorkspaceSessionContext(repoCwd);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.path).toBe(repoCwd);
    expect(result.context.pathStatus.exists).toBe(true);
    expect(result.context.pathStatus.isDirectory).toBe(true);
    expect(result.context.pathStatus.writable).toBe(true);
    expect(result.context.sessionsHere).toEqual([
      { id: sessionId, provider: "Claude", title: null },
    ]);
    expect(result.context.providers.claude.inAppCount).toBe(1);
  });

  it("rejects invalid paths", () => {
    const result = getWorkspaceSessionContext("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/path/i);
  });
});
