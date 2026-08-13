import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-session-work-status-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { drizzleSqlite } = await import("../db/index.ts");
const { getSessionWorkStatus } = await import("./session-work-status.ts");

describe("getSessionWorkStatus", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("reports idle for external CLI sessions with no running delivery job", async () => {
    await expect(getSessionWorkStatus("cc_5c708e22-807e-4579-807a-b56d8e4341e1")).resolves.toBe(
      "idle",
    );
    await expect(getSessionWorkStatus("cur_e6ca1259-5b7f-4de3-afd5-a877811435cb")).resolves.toBe(
      "idle",
    );
  });
});
