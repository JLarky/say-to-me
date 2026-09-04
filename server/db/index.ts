import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { type as arktype } from "arktype";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { dbDir, dbPath, root } from "../config.ts";
import * as schema from "./drizzle-schema.ts";
import { messages, sessions } from "./drizzle-schema.ts";

if (process.env.VITEST === "true") {
  const defaultDbPath = path.join(root, ".local", "queue.sqlite");
  if (dbPath === defaultDbPath) {
    throw new Error(
      "Vitest DB guard: refusing to use the real database path (" +
        defaultDbPath +
        "). Set SAY_TO_ME_DB to a test-specific path, like a file under a unique temp directory (queue.test.sqlite).",
    );
  }
}

if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { mode: 0o700, recursive: true });
}

export const drizzleSqlite = new Database(dbPath);
drizzleSqlite.pragma("journal_mode = WAL");
drizzleSqlite.pragma("busy_timeout = 5000");
// Vitest may reuse this module across files (`isolate: false`). Closing the
// handle in afterAll/runtime stop would break later files in the same worker.
if (process.env.VITEST === "true") {
  drizzleSqlite.close = () => drizzleSqlite;
}
export const drizzleDb = drizzle(drizzleSqlite, { schema });

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "drizzle",
);

let dbInitError: Error | null = null;

export function getDbInitError(): Error | null {
  return dbInitError;
}

// Import-time init: catch failures so /api/* doesn't silently fall through to the SPA.
try {
  repairDismissedAtMigrationJournal();
  migrate(drizzleDb, { migrationsFolder });

  drizzleDb.insert(sessions).values({ id: "default" }).onConflictDoNothing().run();

  // On startup, reset any messages stuck in "speaking" back to "stopped"
  // (server restart kills activeSay but leaves DB status stale; "queued" would cause autoplay loop)
  drizzleDb
    .update(messages)
    .set({ status: "stopped" })
    .where(eq(messages.status, "speaking"))
    .run();
} catch (error) {
  dbInitError = error instanceof Error ? error : new Error(String(error));
  logDbInitFailure(dbInitError);
}

function logDbInitFailure(error: Error): void {
  const cause = error.cause instanceof Error ? error.cause.message : null;
  const banner = "*".repeat(72);
  console.error(
    [
      "",
      banner,
      "*** DATABASE INITIALIZATION FAILED — server is running DEGRADED ***",
      "*** /api/health will report 503 until this is resolved.",
      `*** error: ${error.message}`,
      ...(cause ? [`*** cause: ${cause}`] : []),
      banner,
      "",
    ].join("\n"),
  );
}

/** Clear all app rows so the next isolate:false file starts from migrated defaults. */
export function wipeTestDatabase(): void {
  if (process.env.VITEST !== "true") {
    throw new Error("wipeTestDatabase is only available under Vitest");
  }
  const tables = drizzleSqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name != '__drizzle_migrations'`,
    )
    .all() as Array<{ name: string }>;
  drizzleSqlite.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const { name } of tables) {
      drizzleSqlite.exec(`DELETE FROM "${name}"`);
    }
  } finally {
    drizzleSqlite.exec("PRAGMA foreign_keys = ON");
  }
  drizzleDb.insert(sessions).values({ id: "default" }).onConflictDoNothing().run();
}

const SqliteTableInfoColumn = arktype({ name: "string" });

function repairDismissedAtMigrationJournal() {
  const notificationColumns = drizzleSqlite.prepare("PRAGMA table_info(notifications)").all();
  const hasDismissedAt = notificationColumns.some((column) => {
    const parsed = SqliteTableInfoColumn(column);
    return !(parsed instanceof arktype.errors) && parsed.name === "dismissed_at";
  });
  if (!hasDismissedAt) return;

  const migration = readMigrationFiles({ migrationsFolder }).find((file) =>
    file.sql.some((statement) => statement.includes("ADD `dismissed_at`")),
  );
  if (!migration) return;

  const migrationTableExists = drizzleSqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (!migrationTableExists) return;

  const existing = drizzleSqlite
    .prepare("SELECT 1 FROM __drizzle_migrations WHERE hash = ?")
    .get(migration.hash);
  if (existing) return;

  drizzleSqlite
    .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
    .run(migration.hash, migration.folderMillis);
}
