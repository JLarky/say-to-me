import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(root, ".env");

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

export default defineConfig({
  schema: "./server/db/drizzle-schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.SAY_TO_ME_DB || path.join(root, ".local", "queue.sqlite"),
  },
});
