import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "import-order-guard-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { dbPath, root } = await import("../config.ts");

describe("DB import-order guard", () => {
  afterAll(() => {
    rmSync(testDbDir, { recursive: true, force: true });
  });

  it("loads the database module when SAY_TO_ME_DB points to a test path", async () => {
    const dbModule = await import("../db/index.ts");
    expect(dbModule.drizzleDb).toBeDefined();
    expect(dbModule.drizzleSqlite).toBeDefined();
  });

  it("rejects the real database path under Vitest", () => {
    const defaultDbPath = path.join(root, ".local", "queue.sqlite");
    expect(dbPath).not.toBe(defaultDbPath);
    expect(dbPath).toBe(path.join(testDbDir, "queue.sqlite"));
  });
});
