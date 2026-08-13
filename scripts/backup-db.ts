import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { dbPath } from "../server/config.ts";

const backupDir = path.join(os.homedir(), "vm", "backups", "say-to-me");
const retentionCount = 20;

function warnIfCronMissing(): void {
  let crontab = "";
  try {
    crontab = execSync("crontab -l", { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    // no crontab installed at all
  }
  if (crontab.includes("backup-db.ts")) return;

  console.warn(
    [
      "",
      "*** WARNING: no crontab entry found for backup-db.ts on this machine. ***",
      "*** This backup ran manually/once, it will NOT repeat automatically. ***",
      "*** Install a recurring cron job, e.g.:",
      `***   ( crontab -l 2>/dev/null; echo "17 */6 * * * cd ${path.resolve(import.meta.dirname, "..")} && ${process.execPath} scripts/backup-db.ts >> ${path.join(backupDir, "backup.log")} 2>&1" ) | crontab -`,
      "",
    ].join("\n"),
  );
}

mkdirSync(backupDir, { recursive: true });

if (!existsSync(dbPath)) {
  console.log(`No database at ${dbPath}, skipping backup`);
  process.exit(0);
}

const db = new Database(dbPath);
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(backupDir, `queue.sqlite.${timestamp}`);
copyFileSync(dbPath, backupPath);
console.log(`Backed up ${dbPath} to ${backupPath}`);

const backups = readdirSync(backupDir)
  .filter((name) => name.startsWith("queue.sqlite."))
  .map((name) => ({ name, mtime: statSync(path.join(backupDir, name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

for (const stale of backups.slice(retentionCount)) {
  unlinkSync(path.join(backupDir, stale.name));
  console.log(`Pruned old backup ${stale.name}`);
}

warnIfCronMissing();
