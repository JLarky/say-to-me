import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  ensureVitestOwnedDbExitCleanup,
  installVitestOwnedDatabase,
  isVitestOwnedDbPath,
  removeVitestOwnedDirectory,
} from "./vitest-owned-db.ts";

describe("Vitest owned database policy", () => {
  const preciousDir = mkdtempSync(path.join(tmpdir(), "precious-caller-db-"));
  const preciousDb = path.join(preciousDir, "queue.sqlite");
  const ownedDirs: string[] = [];

  writeFileSync(preciousDb, "caller-owned-do-not-delete");

  afterAll(() => {
    for (const dir of ownedDirs) {
      try {
        removeVitestOwnedDirectory(dir);
      } catch {
        // already removed by the assertion under test
      }
    }
    rmSync(preciousDir, { recursive: true, force: true });
  });

  it("overwrites an inherited SAY_TO_ME_DB instead of adopting it", () => {
    const env: NodeJS.ProcessEnv = { SAY_TO_ME_DB: preciousDb };
    const owned = installVitestOwnedDatabase(env, { forceNew: true });
    ownedDirs.push(owned.dbDir);

    expect(env.SAY_TO_ME_DB).toBe(owned.dbPath);
    expect(env.SAY_TO_ME_DB).not.toBe(preciousDb);
    expect(isVitestOwnedDbPath(env.SAY_TO_ME_DB)).toBe(true);
    expect(isVitestOwnedDbPath(preciousDb)).toBe(false);
    expect(existsSync(preciousDb)).toBe(true);
  });

  it("refuses to delete a caller-provided database directory", () => {
    expect(() => removeVitestOwnedDirectory(preciousDir)).toThrow(/Refusing to remove/);
    expect(existsSync(preciousDb)).toBe(true);
  });

  it("only deletes directories it created", () => {
    const env: NodeJS.ProcessEnv = { SAY_TO_ME_DB: preciousDb };
    const owned = installVitestOwnedDatabase(env, { forceNew: true });
    removeVitestOwnedDirectory(owned.dbDir);

    expect(existsSync(owned.dbDir)).toBe(false);
    expect(existsSync(preciousDb)).toBe(true);
  });

  it("registers at most one exit cleanup listener per worker", () => {
    const before = process.listenerCount("exit");
    for (let i = 0; i < 20; i += 1) {
      ensureVitestOwnedDbExitCleanup();
      installVitestOwnedDatabase();
    }
    expect(process.listenerCount("exit")).toBe(before);
  });
});
