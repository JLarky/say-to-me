import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { BooSession, StartCommandOptions } from "../boo/driver.ts";
import { cursorBooWorkerName, ensureCursorBooWorker } from "../external-cli/providers.ts";

describe("ensureCursorBooWorker", () => {
  const sessionId = "cur_00000000-0000-0000-0000-000000000000";
  let previousInternalUrl: string | undefined;

  beforeEach(() => {
    delete process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART;
    delete process.env.SAY_TO_ME_CURSOR_WORKER_MODE;
    previousInternalUrl = process.env.SAY_TO_ME_INTERNAL_URL;
    process.env.SAY_TO_ME_INTERNAL_URL = "http://127.0.0.1:5412";
  });

  afterEach(() => {
    delete process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART;
    delete process.env.SAY_TO_ME_CURSOR_WORKER_MODE;
    if (previousInternalUrl === undefined) delete process.env.SAY_TO_ME_INTERNAL_URL;
    else process.env.SAY_TO_ME_INTERNAL_URL = previousInternalUrl;
  });

  it("autostarts with real cursor mode and without disabling TLS verification", async () => {
    const started: StartCommandOptions[] = [];
    const driver = {
      killSession: async (): Promise<string> => "killed",
      listSessions: async (): Promise<BooSession[]> => [],
      startCommand: async (options: StartCommandOptions): Promise<string> => {
        started.push(options);
        return "started";
      },
    };
    await ensureCursorBooWorker(sessionId, driver);
    expect(started).toHaveLength(1);
    const { resolveWorkerInternalUrl } = await import("../external-cli/worker-internal-url.ts");
    expect(started[0]?.args).toContain(`SAY_TO_ME_INTERNAL_URL=${resolveWorkerInternalUrl()}`);
    expect(started[0]?.args).toContain("SAY_TO_ME_CURSOR_WORKER_MODE=cursor");
    expect(started[0]?.args?.some((arg) => arg.startsWith("NODE_TLS_REJECT_UNAUTHORIZED="))).toBe(
      false,
    );
    expect(started[0]?.name).toBe(cursorBooWorkerName(sessionId));
  });
});
