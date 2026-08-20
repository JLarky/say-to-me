import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, describe, expect, it } from "vite-plus/test";

import * as schema from "./drizzle-schema.ts";
import { messages } from "./drizzle-schema.ts";

type TestDb = ReturnType<typeof openDb>["db"];

const migrationsFolder = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
  "drizzle",
);
const testRoot = mkdtempSync(path.join(tmpdir(), "say-to-me-cli-unconfirmed-migration-"));

function openDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function migrationsThrough(tagPrefix: string): string {
  const dest = path.join(testRoot, `migrations-${tagPrefix}`);
  mkdirSync(dest, { recursive: true });
  cpSync(migrationsFolder, dest, { recursive: true });
  const journalPath = path.join(dest, "meta", "_journal.json");
  // SAFETY: this is our own committed drizzle journal, copied verbatim above;
  // the migrator would already have refused to run if its shape were wrong.
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const cutoff = journal.entries.findIndex((entry) => entry.tag.startsWith(tagPrefix));
  expect(cutoff).toBeGreaterThanOrEqual(0);
  journal.entries = journal.entries.slice(0, cutoff);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return dest;
}

function insertMessage(db: TestDb, sessionId: string, status: string | null): number {
  const row = db
    .insert(messages)
    .values({
      sessionId,
      text: "stranded before the collapse",
      author: "user",
      status: "received",
      opencodeDeliveryStatus: status,
    })
    .returning({ id: messages.id })
    .get();
  return row.id;
}

function deliveryStatus(db: TestDb, id: number): string | null {
  const row = db
    .select({ status: messages.opencodeDeliveryStatus })
    .from(messages)
    .where(eq(messages.id, id))
    .get();
  if (!row) throw new Error(`Message ${id} disappeared.`);
  return row.status;
}

/**
 * `cli_unconfirmed` is gone from `deliveryStatuses`, so a surviving row would
 * render as the raw string with no Retry button — exactly the stuck state this
 * change exists to remove. Rewrite them instead of leaving them unreachable.
 */
describe("cli_unconfirmed collapse migration", () => {
  afterAll(() => {
    rmSync(testRoot, { force: true, recursive: true });
  });

  it("rewrites pre-existing cli_unconfirmed rows to failed and leaves others alone", () => {
    const dbPath = path.join(testRoot, "upgrade.sqlite");
    const beforeFolder = migrationsThrough("0034_");

    let unconfirmedId = 0;
    let sentId = 0;
    let failedId = 0;
    let untrackedId = 0;
    const prepared = openDb(dbPath);
    try {
      migrate(prepared.db, { migrationsFolder: beforeFolder });
      unconfirmedId = insertMessage(prepared.db, "cur_old", "cli_unconfirmed");
      sentId = insertMessage(prepared.db, "cur_old", "sent");
      failedId = insertMessage(prepared.db, "cur_old", "failed");
      untrackedId = insertMessage(prepared.db, "cur_old", null);
      expect(deliveryStatus(prepared.db, unconfirmedId)).toBe("cli_unconfirmed");
    } finally {
      prepared.sqlite.close();
    }

    const upgraded = openDb(dbPath);
    try {
      migrate(upgraded.db, { migrationsFolder });
      expect(deliveryStatus(upgraded.db, unconfirmedId)).toBe("failed");
      expect(deliveryStatus(upgraded.db, sentId)).toBe("sent");
      expect(deliveryStatus(upgraded.db, failedId)).toBe("failed");
      expect(deliveryStatus(upgraded.db, untrackedId)).toBeNull();
    } finally {
      upgraded.sqlite.close();
    }
  });
});
