import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { type as arktype } from "arktype";

const SqlObject = arktype({ sql: "string" });
const TableDefinition = arktype({ name: "string", sql: "string" });
const TableColumn = arktype({ name: "string" });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = process.env.SAY_TO_ME_DB || path.join(repoRoot, ".local", "queue.sqlite");
const outputPath = "/tmp/say.sql";

const db = new DatabaseSync(dbPath);

const quoteIdent = (value: string) => `"${value.replaceAll('"', '""')}"`;

const tables = db
  .prepare(
    `SELECT name, sql
     FROM sqlite_master
     WHERE type = 'table'
       AND sql IS NOT NULL
       AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  )
  .all()
  .map((row) => TableDefinition.assert(row));

const extras = db
  .prepare(
    `SELECT type, name, sql
     FROM sqlite_master
     WHERE type IN ('index', 'trigger', 'view')
       AND sql IS NOT NULL
       AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type
       WHEN 'index' THEN 0
       WHEN 'trigger' THEN 1
       ELSE 2
     END, name`,
  )
  .all()
  .map((row) => SqlObject.assert(row));

const lines = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;", ""];

for (const table of tables) {
  lines.push(`${table.sql};`);

  const escapedTableName = quoteIdent(table.name);
  const columns = db
    .prepare(`PRAGMA table_info(${escapedTableName})`)
    .all()
    .map((row) => TableColumn.assert(row));

  if (columns.length > 0) {
    const columnNames = columns.map((column) => quoteIdent(column.name)).join(", ");
    const valueExpr = columns
      .map((column) => `quote(${quoteIdent(column.name)})`)
      .join(` || ', ' || `);
    const insertSql = db
      .prepare(
        `SELECT 'INSERT INTO ${escapedTableName} (${columnNames}) VALUES(' || ${valueExpr} || ');' AS sql
         FROM ${escapedTableName}`,
      )
      .all()
      .map((row) => SqlObject.assert(row));

    for (const row of insertSql) lines.push(row.sql);
  }

  lines.push("");
}

for (const extra of extras) {
  lines.push(`${extra.sql};`);
}

lines.push("", "COMMIT;", "");

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, lines.join("\n"), "utf8");

console.log(`Exported SQLite dump from ${dbPath} to ${outputPath}`);
