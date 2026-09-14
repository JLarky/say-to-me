import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type as arktype } from "arktype";
import { readMigrationFiles } from "drizzle-orm/migrator";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDbPath = path.join(repoRoot, ".local", "queue.sqlite");
const migrationsFolder = path.join(repoRoot, "drizzle");
const sourceArg = process.argv[2];

if (!sourceArg) {
  console.error("Usage: pnpm db:compat -- /path/to/copied/queue.sqlite");
  process.exit(1);
}

const sourcePath = path.resolve(sourceArg);

if (!existsSync(sourcePath)) {
  console.error(`Database does not exist: ${sourcePath}`);
  process.exit(1);
}

if (sourcePath === defaultDbPath && !process.argv.includes("--allow-local-source")) {
  console.error(
    "Refusing to read the default live .local/queue.sqlite. Copy it elsewhere first, or pass --allow-local-source if you intentionally want to read it.",
  );
  process.exit(1);
}

const tempDir = mkdtempSync(path.join(tmpdir(), "say-to-me-db-compat-"));
const tempDbPath = path.join(tempDir, "queue.sqlite");

const DbIntegrityRow = arktype({ integrity_check: "string" });
const DbMigrationRow = arktype({ hash: "string" });
const DbTableInfoRow = arktype({ name: "string" });

const requiredColumns = {
  sessions: [
    "id",
    "created_at",
    "updated_at",
    "state",
    "alias",
    "revision",
    "opencode_project_id",
    "opencode_workspace_id",
    "opencode_directory",
    "opencode_worktree",
    "opencode_path",
    "opencode_project_name",
    "opencode_branch",
    "opencode_selected_model_provider",
    "opencode_selected_model",
  ],
  messages: [
    "id",
    "session_id",
    "text",
    "status",
    "pinned",
    "author",
    "parent_id",
    "attached_session_id",
    "opencode_delivery_status",
    "opencode_delivery_error",
    "opencode_message_id",
    "client_message_id",
    "links",
    "session_refs",
    "extra_markdown",
    "merged_into_message_id",
    "forward_role",
    "forward_source_session_id",
    "forward_source_message_id",
    "forward_target_session_id",
    "forward_target_message_id",
    "forward_status",
    "created_at",
  ],
  session_notes: ["id", "session_id", "content", "created_at"],
  message_attachments: [
    "id",
    "message_id",
    "file_path",
    "original_name",
    "mime_type",
    "thumbnail_data_url",
    "thumbnail_width",
    "thumbnail_height",
    "created_at",
  ],
} satisfies Record<string, string[]>;

try {
  copyFileSync(sourcePath, tempDbPath);
  process.env.SAY_TO_ME_DB = tempDbPath;

  const { drizzleSqlite } = await import("../server/db/index.ts");

  try {
    const integrity = DbIntegrityRow.assert(drizzleSqlite.prepare("PRAGMA integrity_check").get());
    const integrityResult = integrity.integrity_check;

    if (integrityResult !== "ok") {
      throw new Error(`PRAGMA integrity_check failed: ${integrityResult}`);
    }

    const missing: string[] = [];

    for (const [table, columns] of Object.entries(requiredColumns)) {
      const rows = drizzleSqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => DbTableInfoRow.assert(row));
      const existing = new Set(rows.map((row) => row.name));

      for (const column of columns) {
        if (!existing.has(column)) missing.push(`${table}.${column}`);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing columns after migrations: ${missing.join(", ")}`);
    }

    const migrationRows = drizzleSqlite
      .prepare("SELECT hash FROM __drizzle_migrations")
      .all()
      .map((row) => DbMigrationRow.assert(row));

    if (migrationRows.length === 0) {
      throw new Error("No Drizzle migration metadata found after compatibility check");
    }

    const appliedMigrationHashes = new Set(migrationRows.map((row) => row.hash));
    const missingMigrationTags = readMigrationFiles({ migrationsFolder })
      .filter((migration) => !appliedMigrationHashes.has(migration.hash))
      .map((migration) => String(migration.folderMillis));

    if (missingMigrationTags.length > 0) {
      throw new Error(`Missing Drizzle migrations: ${missingMigrationTags.join(", ")}`);
    }

    const foreignKeyRows = drizzleSqlite.prepare("PRAGMA foreign_key_check").all();

    if (foreignKeyRows.length > 0) {
      throw new Error(`PRAGMA foreign_key_check returned ${foreignKeyRows.length} row(s)`);
    }

    console.log(`Database compatibility check passed for copied snapshot: ${sourcePath}`);
  } finally {
    drizzleSqlite.close();
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
