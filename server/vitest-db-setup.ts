import { afterAll } from "vite-plus/test";
import { installVitestOwnedDatabase } from "./vitest-owned-db.ts";

// Runs before every test file. With `isolate: false` the module graph is reused,
// so env that config.ts reads at import time must be set here on the first file
// — before any server module loads.
// Always overwrite inherited SAY_TO_ME_DB so a caller's real database is never
// migrated or wiped by the suite. Exit cleanup is registered once per worker
// inside installVitestOwnedDatabase / ensureVitestOwnedDbExitCleanup.
const owned = installVitestOwnedDatabase();
process.env.SAY_TO_ME_MIN_MESSAGE_LENGTH ??= "2";
process.env.SAY_TO_ME_MAX_MESSAGE_LENGTH ??= "256";
process.env.SAY_TO_ME_MAX_QUEUED_MESSAGES ??= "2";
process.env.SAY_TO_ME_MAX_TOTAL_MESSAGES ??= "3";
process.env.SAY_TO_ME_OPENCODE_URL ??= "http://127.0.0.1:1";
process.env.SAY_TO_ME_INTERNAL_URL ??= "http://127.0.0.1:1";
process.env.SAY_TO_ME_INTERNAL_API_TOKEN ??= "test-internal-api-token";
process.env.OTEL_ENABLED ??= "false";

const originalHome = process.env.HOME;

// Restore process-wide env leaks after each file so the next shared-module file
// does not inherit HOME / external CLI state roots from unit tests.
afterAll(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
  // Keep pointing at the Vitest-owned path even if a file temporarily overwrote it.
  process.env.SAY_TO_ME_DB = owned.dbPath;
  try {
    const { wipeTestDatabase } = await import("./db/index.ts");
    wipeTestDatabase();
  } catch {
    // DB module may not have been loaded by this file.
  }
});
