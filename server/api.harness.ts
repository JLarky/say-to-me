import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseJson, UnknownJson } from "@say-to-me/runtime-validation";
import type { ApiMessage, ApiSession } from "./api.harness.types.ts";
import { closeTestServer, closeTestServerEffect, listen, type TestServer } from "./test-http.ts";
import { createTestRequest, expectHandledResponse } from "./test-request.ts";
import { isVitestOwnedDbPath, registerHarnessTempDbDir } from "./vitest-owned-db.ts";

export type { ApiMessage, ApiSession, TestServer };
export { closeTestServer, closeTestServerEffect, createTestRequest, expectHandledResponse, listen };

// One sqlite path per worker process. With isolate:false the harness module is
// reused across files in that worker; parallel workers still get distinct DBs.
// Never keep an arbitrary inherited SAY_TO_ME_DB — only a Vitest-owned temp path.
const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-test-"));
const testDbPath = path.join(testDbDir, "queue.sqlite");
if (!isVitestOwnedDbPath(process.env.SAY_TO_ME_DB)) {
  process.env.SAY_TO_ME_DB = testDbPath;
}
registerHarnessTempDbDir(testDbDir);
process.env.SAY_TO_ME_MIN_MESSAGE_LENGTH = "2";
process.env.SAY_TO_ME_MAX_MESSAGE_LENGTH = "256";
process.env.SAY_TO_ME_MAX_QUEUED_MESSAGES = "2";
process.env.SAY_TO_ME_MAX_TOTAL_MESSAGES = "3";
process.env.SAY_TO_ME_OPENCODE_URL = "http://127.0.0.1:1";
// Keep any internal delivery workers from falling back to the shared say.local
// endpoint during tests. Individual worker tests override this with a local server.
process.env.SAY_TO_ME_INTERNAL_URL = "http://127.0.0.1:1";
// Keep prompt and CLI-origin tests deterministic; isolated process tests set
// SAY_TO_ME_URL explicitly in their own environment.
process.env.SAY_TO_ME_URL = "http://127.0.0.1:5411";
process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
process.env.OTEL_ENABLED = "false";

const { closeApi, createApiMiddleware } = await import("./api.ts");
const { drizzleDb, wipeTestDatabase } = await import("./db/index.ts");

let testTransactionActive = false;

export { closeApi, createApiMiddleware };

export async function createTestSession(sessionId: string): Promise<void> {
  const { ensureSession } = await import("./sessions.ts");
  ensureSession(sessionId);
}

// Stops the host runtime between files. Keeps the worker's temp DB open so
// `isolate: false` can reuse the harness/api module graph; createApiMiddleware
// restarts the runtime on the next file. Final DB cleanup happens on process exit.
export async function teardownApi(): Promise<void> {
  if (!testTransactionActive) {
    drizzleDb.run("BEGIN");
    testTransactionActive = true;
  }
  await closeApi();
  drizzleDb.run("ROLLBACK");
  testTransactionActive = false;
  wipeTestDatabase();
}

export const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ6cAAAAASUVORK5CYII=",
  "base64",
);

type MockRequest = { method: string | undefined; url: string | undefined; body: unknown };

export function mockOpenCode(
  handler: (req: IncomingMessage, res: ServerResponse, count: number) => void,
): Promise<{
  requests: MockRequest[];
  server: ReturnType<typeof createServer>;
  url: string;
}> {
  return new Promise((resolve) => {
    const requests: MockRequest[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: req.method,
        url: req.url,
        body: body ? parseJson(UnknownJson, body) : null,
      });
      handler(req, res, requests.length);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({ requests, server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

export async function clearQueue(origin: string) {
  void origin;
  // Test-only reset: each API test starts from the migrated default DB state.
  // Rollback avoids creating persistent cleanup garbage in the first place.
  if (testTransactionActive) drizzleDb.run("ROLLBACK");
  drizzleDb.run("BEGIN");
  testTransactionActive = true;
}

/** End the harness per-test transaction so a second sqlite connection can write. */
export function commitTestTransaction(): void {
  if (!testTransactionActive) return;
  drizzleDb.run("COMMIT");
  testTransactionActive = false;
}

/** Resume the harness per-test transaction after commitTestTransaction(). */
export function beginTestTransaction(): void {
  if (testTransactionActive) return;
  drizzleDb.run("BEGIN");
  testTransactionActive = true;
}

export function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(async () => {
      try {
        if (await condition()) {
          clearInterval(timer);
          resolve();
        } else if (performance.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error("Timed out waiting for condition"));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 5);
  });
}
