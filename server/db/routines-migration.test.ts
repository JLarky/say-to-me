import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, describe, expect, it } from "vite-plus/test";

import * as schema from "./drizzle-schema.ts";
import { routines } from "./drizzle-schema.ts";

const migrationsFolder = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
  "drizzle",
);
const testRoot = mkdtempSync(path.join(tmpdir(), "say-to-me-routines-migration-"));

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
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const cutoff = journal.entries.findIndex((entry) => entry.tag.startsWith(tagPrefix));
  expect(cutoff).toBeGreaterThanOrEqual(0);
  journal.entries = journal.entries.slice(0, cutoff);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return dest;
}

function tableNames(sqlite: Database.Database): string[] {
  return sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

describe("jarvis_timers to routines migration", () => {
  afterAll(() => {
    rmSync(testRoot, { force: true, recursive: true });
  });

  it("migrates jarvis_timers rows into routines and drops the old table", () => {
    const dbPath = path.join(testRoot, "upgrade.sqlite");
    const beforeFolder = migrationsThrough("0035_");
    const dueAt = Date.parse("2026-07-18T12:00:00Z");
    const nextFireAt = dueAt + 60_000;
    const prepared = openDb(dbPath);
    try {
      migrate(prepared.db, { migrationsFolder: beforeFolder });
      expect(tableNames(prepared.sqlite)).toContain("jarvis_timers");
      expect(tableNames(prepared.sqlite)).not.toContain("routines");

      prepared.sqlite
        .prepare(
          `INSERT INTO jarvis_timers (
             session_id, title, message, status, due_at, interval_ms, next_fire_at, last_fired_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "ses_migrate123456789012345678901",
          "Legacy timer",
          "Carry this message forward",
          "completed",
          dueAt,
          120_000,
          nextFireAt,
          dueAt,
        );
    } finally {
      prepared.sqlite.close();
    }

    const upgraded = openDb(dbPath);
    try {
      migrate(upgraded.db, { migrationsFolder });
      expect(tableNames(upgraded.sqlite)).toContain("routines");
      expect(tableNames(upgraded.sqlite)).not.toContain("jarvis_timers");

      const rows = upgraded.db.select().from(routines).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ownerSessionId: "ses_migrate123456789012345678901",
        status: "fired",
        title: "Legacy timer",
        triggerKind: "schedule",
        nextFireAt,
        lastFiredAt: dueAt,
      });

      const trigger = JSON.parse(rows[0]!.trigger) as {
        kind: string;
        dueAt: number;
        intervalMs: number | null;
        nextFireAt: number;
      };
      expect(trigger).toEqual({
        kind: "schedule",
        dueAt,
        intervalMs: 120_000,
        nextFireAt,
      });

      const action = JSON.parse(rows[0]!.action) as {
        kind: string;
        title: string;
        message: string;
      };
      expect(action).toEqual({
        kind: "deliver_prompt",
        title: "Legacy timer",
        message: "Carry this message forward",
      });
    } finally {
      upgraded.sqlite.close();
    }
  });
});
