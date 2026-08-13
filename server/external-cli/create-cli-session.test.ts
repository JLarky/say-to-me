import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "create-cli-session-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { getSession } = await import("../sessions.ts");
const { createCliSessionRecord } = await import("./create-cli-session.ts");
const { drizzleSqlite } = await import("../db/index.ts");

describe("createCliSessionRecord", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { recursive: true, force: true });
  });

  it("bootstraps a real Codex thread id at create time", async () => {
    const threadId = "019f47da-8685-77d2-ba50-1ee4878ecac1";
    const session = await createCliSessionRecord(
      "codex",
      "/tmp/say-to-me-codex-create",
      "gpt-5.4",
      {
        bootstrapCodexThread: async () => threadId,
      },
    );

    expect(session.id).toBe(`cx_${threadId}`);
    expect(session.cwd).toBe("/tmp/say-to-me-codex-create");
    expect(session.opencodeSelectedModelProvider).toBe("openai");
    expect(session.opencodeSelectedModel).toBe("gpt-5.4");
    expect(getSession(session.id)?.id).toBe(session.id);
  });

  it("bootstraps a real Grok session id at create time", async () => {
    const sessionId = "019f49db-d67f-71f2-b5c6-2f0c6fe8ce62";
    const session = await createCliSessionRecord("grok", "/tmp/say-to-me-grok-create", "grok-4.5", {
      bootstrapGrokSession: async () => sessionId,
    });

    expect(session.id).toBe(`gr_${sessionId}`);
    expect(session.cwd).toBe("/tmp/say-to-me-grok-create");
    expect(session.opencodeSelectedModelProvider).toBe("xai");
    expect(session.opencodeSelectedModel).toBe("grok-4.5");
    expect(getSession(session.id)?.id).toBe(session.id);
  });

  it("keeps random ids for providers without create bootstrap", async () => {
    const session = await createCliSessionRecord("claude", "/tmp/say-to-me-claude-create", "opus");
    expect(session.id.startsWith("cc_")).toBe(true);
    expect(session.opencodeSelectedModelProvider).toBe("anthropic");
    expect(session.opencodeSelectedModel).toBe("opus");
  });

  it("surfaces Codex bootstrap failures", async () => {
    await expect(
      createCliSessionRecord("codex", "/tmp/say-to-me-codex-create", "gpt-5.4", {
        bootstrapCodexThread: async () => {
          throw new Error("Codex bootstrap failed: usage limit");
        },
      }),
    ).rejects.toThrow("Codex bootstrap failed: usage limit");
  });

  it("surfaces Grok bootstrap failures", async () => {
    await expect(
      createCliSessionRecord("grok", "/tmp/say-to-me-grok-create", "grok-4.5", {
        bootstrapGrokSession: async () => {
          throw new Error("Grok bootstrap failed: 404 Not Found");
        },
      }),
    ).rejects.toThrow("Grok bootstrap failed: 404 Not Found");
  });
});
