import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { BooSession, StartCommandOptions } from "../boo/driver.ts";
import {
  ensureClaudeBooWorker,
  scheduleClaudeBooWorkerReplacement,
} from "../external-cli/providers.ts";

// A fake BooDriver: `listSessions` reports the stale worker's name present for
// the first `staleFor` calls, then absent (the stale worker has exited).
function fakeDriver(name: string, staleFor: number) {
  let calls = 0;
  const started: StartCommandOptions[] = [];
  return {
    started,
    listSessions: async (): Promise<BooSession[]> => {
      calls += 1;
      return calls <= staleFor ? [{ name }] : [];
    },
    startCommand: async (options: StartCommandOptions): Promise<string> => {
      started.push(options);
      return "started";
    },
  };
}

describe("scheduleClaudeBooWorkerReplacement", () => {
  const sessionId = "cc_00000000-0000-0000-0000-000000000000";
  const name = `stm_5412_${sessionId}`;
  let previousInternalUrl: string | undefined;

  beforeEach(() => {
    delete process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART;
    delete process.env.SAY_TO_ME_CLAUDE_WORKER_MODE;
    previousInternalUrl = process.env.SAY_TO_ME_INTERNAL_URL;
    process.env.SAY_TO_ME_INTERNAL_URL = "http://127.0.0.1:5412";
  });

  afterEach(() => {
    delete process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART;
    delete process.env.SAY_TO_ME_CLAUDE_WORKER_MODE;
    if (previousInternalUrl === undefined) delete process.env.SAY_TO_ME_INTERNAL_URL;
    else process.env.SAY_TO_ME_INTERNAL_URL = previousInternalUrl;
  });

  it("autostarts with real claude mode and without disabling TLS verification", async () => {
    const started: StartCommandOptions[] = [];
    const driver = {
      listSessions: async (): Promise<BooSession[]> => [],
      startCommand: async (options: StartCommandOptions): Promise<string> => {
        started.push(options);
        return "started";
      },
    };
    await ensureClaudeBooWorker(sessionId, driver);
    expect(started).toHaveLength(1);
    const { resolveWorkerInternalUrl } = await import("../external-cli/worker-internal-url.ts");
    expect(started[0]?.args).toContain(`SAY_TO_ME_INTERNAL_URL=${resolveWorkerInternalUrl()}`);
    expect(started[0]?.args).toContain(`SAY_TO_ME_URL=${resolveWorkerInternalUrl()}`);
    expect(started[0]?.args).toContain("SAY_TO_ME_CLAUDE_WORKER_MODE=claude");
    expect(started[0]?.args?.some((arg) => arg.startsWith("NODE_TLS_REJECT_UNAUTHORIZED="))).toBe(
      false,
    );
  });

  it("retries until the stale worker's name frees, then starts a fresh worker", async () => {
    const driver = fakeDriver(name, 2);
    await scheduleClaudeBooWorkerReplacement(sessionId, {
      driver,
      intervalMs: 1,
      maxAttempts: 10,
    });
    expect(driver.started).toHaveLength(1);
    expect(driver.started[0]?.name).toBe(name);
  });

  it("gives up after maxAttempts without starting a worker", async () => {
    const driver = fakeDriver(name, 100); // name never frees
    await scheduleClaudeBooWorkerReplacement(sessionId, {
      driver,
      intervalMs: 1,
      maxAttempts: 3,
    });
    expect(driver.started).toHaveLength(0);
  });

  it("does nothing when autostart is disabled", async () => {
    process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
    const driver = fakeDriver(name, 0);
    await scheduleClaudeBooWorkerReplacement(sessionId, { driver, intervalMs: 1, maxAttempts: 3 });
    expect(driver.started).toHaveLength(0);
  });
});
