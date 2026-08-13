import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OWNED_DB_GLOBAL = "__sayToMeVitestOwnedDb" as const;
const EXIT_CLEANUP_GLOBAL = "__sayToMeVitestOwnedDbExitCleanup" as const;
const HARNESS_DIRS_GLOBAL = "__sayToMeVitestHarnessDbDirs" as const;

type OwnedDbState = {
  dbDir: string;
  dbPath: string;
};

type GlobalWithOwnedDb = typeof globalThis & {
  [OWNED_DB_GLOBAL]?: OwnedDbState;
  [EXIT_CLEANUP_GLOBAL]?: true;
  [HARNESS_DIRS_GLOBAL]?: Set<string>;
};

export type InstallVitestOwnedDatabaseOptions = {
  /** Create a new owned dir even if this worker already installed one. */
  forceNew?: boolean;
  createTempDir?: typeof mkdtempSync;
};

function ownedDbState(): OwnedDbState | undefined {
  return (globalThis as GlobalWithOwnedDb)[OWNED_DB_GLOBAL];
}

function setOwnedDbState(state: OwnedDbState): void {
  (globalThis as GlobalWithOwnedDb)[OWNED_DB_GLOBAL] = state;
}

/** True when `dbPath` is under a temp dir created by Vitest setup or the API harness. */
export function isVitestOwnedDbPath(dbPath: string | undefined): boolean {
  if (!dbPath) return false;
  const dir = path.dirname(path.resolve(dbPath));
  const base = path.basename(dir);
  const tmp = path.resolve(tmpdir());
  if (!dir.startsWith(tmp + path.sep) && dir !== tmp) return false;
  return base.startsWith("vitest-db-") || base.startsWith("say-to-me-test-");
}

/**
 * Register process-exit cleanup at most once per worker. setupFiles re-enter on
 * every test file; without this guard each file adds another `exit` listener.
 */
export function ensureVitestOwnedDbExitCleanup(): void {
  const globalState = globalThis as GlobalWithOwnedDb;
  if (globalState[EXIT_CLEANUP_GLOBAL]) return;
  globalState[EXIT_CLEANUP_GLOBAL] = true;
  process.on("exit", () => {
    const state = ownedDbState();
    if (state) {
      try {
        removeVitestOwnedDirectory(state.dbDir);
      } catch {
        // Best-effort cleanup of the Vitest-owned temp dir only.
      }
    }
    const harnessDirs = globalState[HARNESS_DIRS_GLOBAL];
    if (!harnessDirs) return;
    for (const dbDir of harnessDirs) {
      try {
        rmSync(dbDir, { recursive: true, force: true });
      } catch {
        // Best-effort.
      }
    }
  });
}

/** Track a harness-created temp dir for the single shared exit cleaner. */
export function registerHarnessTempDbDir(dbDir: string): void {
  const globalState = globalThis as GlobalWithOwnedDb;
  const dirs = globalState[HARNESS_DIRS_GLOBAL] ?? new Set<string>();
  dirs.add(path.resolve(dbDir));
  globalState[HARNESS_DIRS_GLOBAL] = dirs;
  ensureVitestOwnedDbExitCleanup();
}

/**
 * Force a Vitest-owned sqlite path into `env`, overwriting any inherited
 * `SAY_TO_ME_DB` (including a caller's real database).
 */
export function installVitestOwnedDatabase(
  env: NodeJS.ProcessEnv = process.env,
  options: InstallVitestOwnedDatabaseOptions = {},
): OwnedDbState {
  const createTempDir = options.createTempDir ?? mkdtempSync;
  if (!options.forceNew) {
    const existing = ownedDbState();
    if (existing) {
      env.SAY_TO_ME_DB = existing.dbPath;
      ensureVitestOwnedDbExitCleanup();
      return existing;
    }
  }
  const dbDir = createTempDir(path.join(tmpdir(), "vitest-db-"));
  const dbPath = path.join(dbDir, "queue.sqlite");
  const state = { dbDir, dbPath };
  if (!options.forceNew) setOwnedDbState(state);
  env.SAY_TO_ME_DB = dbPath;
  ensureVitestOwnedDbExitCleanup();
  return state;
}

/** Remove a directory only if it was created as a Vitest-owned DB parent. */
export function removeVitestOwnedDirectory(dbDir: string): void {
  const resolved = path.resolve(dbDir);
  if (!isVitestOwnedDbPath(path.join(resolved, "queue.sqlite"))) {
    throw new Error(`Refusing to remove non-owned database directory: ${dbDir}`);
  }
  rmSync(resolved, { recursive: true, force: true });
}
