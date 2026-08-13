import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { DEFAULT_SPACE_CONTEXT, DEFAULT_SPACE_ID, DEFAULT_SPACE_NAME } from "./default-space.ts";
import * as schema from "./drizzle-schema.ts";
import { spaces } from "./drizzle-schema.ts";

const migrationsFolder = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
  "drizzle",
);
const testRoot = mkdtempSync(path.join(tmpdir(), "say-to-me-default-space-migration-"));

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

describe("Default space migration seed", () => {
  afterAll(() => {
    rmSync(testRoot, { force: true, recursive: true });
  });

  it("seeds exactly one Default space on a fresh database", () => {
    const dbPath = path.join(testRoot, "fresh.sqlite");
    const { sqlite, db } = openDb(dbPath);
    try {
      migrate(db, { migrationsFolder });
      const rows = db.select().from(spaces).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: DEFAULT_SPACE_ID,
        name: DEFAULT_SPACE_NAME,
        parentId: null,
        context: DEFAULT_SPACE_CONTEXT,
      });
    } finally {
      sqlite.close();
    }
  });

  it("leaves existing databases with spaces unchanged when the seed migration applies", () => {
    const dbPath = path.join(testRoot, "existing.sqlite");
    const beforeFolder = migrationsThrough("0022_");
    const prepared = openDb(dbPath);
    try {
      migrate(prepared.db, { migrationsFolder: beforeFolder });
      // Pre-0024 schema has no sort_order — insert with raw SQL against the old shape.
      prepared.sqlite
        .prepare(
          `INSERT INTO spaces (id, name, parent_id, context, archived, access)
           VALUES (?, ?, NULL, ?, 0, 'private')`,
        )
        .run("existing-custom-space", "Custom", "kept");
    } finally {
      prepared.sqlite.close();
    }

    const upgraded = openDb(dbPath);
    try {
      migrate(upgraded.db, { migrationsFolder });
      const rows = upgraded.db.select().from(spaces).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "existing-custom-space", name: "Custom" });
      expect(rows.some((space) => space.id === DEFAULT_SPACE_ID)).toBe(false);
    } finally {
      upgraded.sqlite.close();
    }
  });

  it("seeds Default once when upgrading an empty pre-0022 database", () => {
    const dbPath = path.join(testRoot, "empty-upgrade.sqlite");
    const beforeFolder = migrationsThrough("0022_");
    const prepared = openDb(dbPath);
    try {
      migrate(prepared.db, { migrationsFolder: beforeFolder });
      expect(prepared.sqlite.prepare("SELECT id FROM spaces").all()).toEqual([]);
    } finally {
      prepared.sqlite.close();
    }

    const upgraded = openDb(dbPath);
    try {
      migrate(upgraded.db, { migrationsFolder });
      const rows = upgraded.db.select().from(spaces).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: DEFAULT_SPACE_ID,
        name: DEFAULT_SPACE_NAME,
      });
    } finally {
      upgraded.sqlite.close();
    }
  });

  it("does not reseed after the Default space is deleted because the migration already ran", () => {
    const dbPath = path.join(testRoot, "deleted.sqlite");
    const created = openDb(dbPath);
    try {
      migrate(created.db, { migrationsFolder });
      created.db.delete(spaces).where(eq(spaces.id, DEFAULT_SPACE_ID)).run();
      expect(created.db.select().from(spaces).all()).toEqual([]);
    } finally {
      created.sqlite.close();
    }

    const restarted = openDb(dbPath);
    try {
      migrate(restarted.db, { migrationsFolder });
      expect(restarted.db.select().from(spaces).all()).toEqual([]);
    } finally {
      restarted.sqlite.close();
    }
  });
});
