import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  claudeProjectDirName,
  claudeSessionFilePath,
  resolveClaudeSessionFlag,
} from "./delivery.ts";

describe("claude project dir mapping", () => {
  let previousRoot: string | undefined;

  beforeEach(() => {
    previousRoot = process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
    delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
  });

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
    else process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = previousRoot;
  });

  it("escapes slashes and dots to dashes (Claude project encoding)", () => {
    expect(claudeProjectDirName("/tmp")).toBe("-tmp");
    expect(claudeProjectDirName("/home/me/vm/say-to-me")).toBe("-home-me-vm-say-to-me");
    expect(claudeProjectDirName("/home/jlarky.guest/.say-to-me/jarvis/restyle")).toBe(
      "-home-jlarky-guest--say-to-me-jarvis-restyle",
    );
  });

  it("builds the session jsonl path under the external CLI state root", () => {
    process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = "/state-root";
    expect(claudeSessionFilePath("/tmp", "abc-123")).toBe(
      path.join("/state-root", ".claude", "projects", "-tmp", "abc-123.jsonl"),
    );
  });

  it("strips the cc_ prefix for the on-disk uuid", () => {
    process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = "/state-root";
    expect(claudeSessionFilePath("/tmp", "cc_abc-123")).toBe(
      path.join("/state-root", ".claude", "projects", "-tmp", "abc-123.jsonl"),
    );
  });
});

describe("resolveClaudeSessionFlag", () => {
  const stateRoot = path.join(tmpdir(), `say-to-me-claude-flag-${process.pid}`);
  const cwd = path.join(stateRoot, "workspace");
  const sessionId = "cc_00000000-0000-0000-0000-000000000001";
  let previousRoot: string | undefined;

  beforeEach(() => {
    previousRoot = process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
    process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = stateRoot;
    rmSync(stateRoot, { force: true, recursive: true });
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(stateRoot, { force: true, recursive: true });
    if (previousRoot === undefined) delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
    else process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = previousRoot;
  });

  it("uses --session-id for brand-new Claude sessions with no transcript (Jarvis bootstrap)", () => {
    const [flag, id] = resolveClaudeSessionFlag(cwd, sessionId);
    expect(flag).toBe("--session-id");
    expect(id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("uses --resume once the Claude transcript jsonl exists", () => {
    const filePath = claudeSessionFilePath(cwd, sessionId);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{}\n");

    const [flag, id] = resolveClaudeSessionFlag(cwd, sessionId);
    expect(flag).toBe("--resume");
    expect(id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("uses --resume for dotted home paths that match Claude's real project encoding", () => {
    // Regression: slash-only encoding missed transcripts under jlarky.guest / .say-to-me
    // and delivery wrongly chose --session-id → "Session ID … is already in use".
    const dottedCwd = path.join(stateRoot, "home", "jlarky.guest", ".say-to-me", "jarvis", "ws");
    mkdirSync(dottedCwd, { recursive: true });
    const filePath = claudeSessionFilePath(dottedCwd, sessionId);
    expect(filePath).toContain("-jlarky-guest--say-to-me-");
    expect(filePath).not.toContain("jlarky.guest");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{}\n");

    const [flag] = resolveClaudeSessionFlag(dottedCwd, sessionId);
    expect(flag).toBe("--resume");
  });

  it("uses --resume for faster-tests-jarvis cwd that failed with already-in-use", () => {
    const incidentCwd = "/home/jlarky.guest/.say-to-me/jarvis/faster-tests-jarvis";
    expect(claudeProjectDirName(incidentCwd)).toBe(
      "-home-jlarky-guest--say-to-me-jarvis-faster-tests-jarvis",
    );
    const projectDir = path.join(
      stateRoot,
      ".claude",
      "projects",
      "-home-jlarky-guest--say-to-me-jarvis-faster-tests-jarvis",
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "00000000-0000-0000-0000-000000000001.jsonl"), "{}\n");

    const [flag] = resolveClaudeSessionFlag(incidentCwd, sessionId);
    expect(flag).toBe("--resume");
  });

  it("uses --resume when the transcript exists under another project slug (scan fallback)", () => {
    const alienDir = path.join(stateRoot, ".claude", "projects", "-some-other-project-slug");
    mkdirSync(alienDir, { recursive: true });
    writeFileSync(path.join(alienDir, "00000000-0000-0000-0000-000000000001.jsonl"), "{}\n");

    const [flag] = resolveClaudeSessionFlag(cwd, sessionId);
    expect(flag).toBe("--resume");
  });

  it("falls back to --session-id when projects readdir throws (no defect)", () => {
    const projectsRoot = path.join(stateRoot, ".claude", "projects");
    mkdirSync(projectsRoot, { recursive: true });

    const [flag] = resolveClaudeSessionFlag(cwd, sessionId, {
      // No cwd transcript; projects root appears present so the scan runs and must not throw.
      existsSync: (filePath) => filePath === projectsRoot,
      readdirSync: () => {
        throw new Error("EACCES: permission denied, scandir");
      },
    });
    expect(flag).toBe("--session-id");
  });
});

describe("resolveClaudeSpawnArgs delivery path", () => {
  const stateRoot = path.join(tmpdir(), `say-to-me-claude-spawn-${process.pid}`);
  const cwd = path.join(stateRoot, "workspace");
  const sessionId = "cc_00000000-0000-0000-0000-000000000002";
  let previousRoot: string | undefined;

  beforeEach(() => {
    previousRoot = process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
    process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = stateRoot;
    rmSync(stateRoot, { force: true, recursive: true });
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(stateRoot, { force: true, recursive: true });
    if (previousRoot === undefined) delete process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT;
    else process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT = previousRoot;
  });

  it("spawn args use --session-id even if a stale claim payload said --resume", async () => {
    const { resolveClaudeSpawnArgs } = await import("./rest-delivery-worker.ts");
    // Simulate claim from an older say.local checkout that always returns --resume.
    const staleClaimFlag = ["--resume", "00000000-0000-0000-0000-000000000002"] as const;
    expect(staleClaimFlag[0]).toBe("--resume");

    const args = resolveClaudeSpawnArgs(cwd, sessionId, "bootstrap", "sonnet");
    expect(args).toContain("--session-id");
    expect(args).not.toContain("--resume");
    expect(args).toContain("00000000-0000-0000-0000-000000000002");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
  });

  it("claimClaudeDeliveryJobForWorker runtime also returns --session-id for new transcripts", async () => {
    process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
    const { setSessionCwd } = await import("../sessions.ts");
    const { insertMessageRow } = await import("../messages.ts");
    const {
      claimClaudeDeliveryJobForWorker,
      enqueueClaudeDeliveryJob,
      failClaudeDeliveryJobFromWorker,
    } = await import("./durable-delivery.ts");

    setSessionCwd(sessionId, cwd);
    const message = insertMessageRow({
      sessionId,
      text: "claim path bootstrap",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    enqueueClaudeDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      claudeSessionId: sessionId,
      kind: "direct_user_message",
    });

    const claimed = await claimClaudeDeliveryJobForWorker("claim-flag-test", sessionId);
    expect(claimed).not.toBeNull();
    expect(claimed?.claude.sessionFlag[0]).toBe("--session-id");
    expect(claimed?.claude.sessionFlag[1]).toBe("00000000-0000-0000-0000-000000000002");
    if (claimed) await failClaudeDeliveryJobFromWorker(claimed.job, "test cleanup");
  });

  it("claim path survives projects readdir failure without stranding the lease", async () => {
    process.env.SAY_TO_ME_CLAUDE_WORKER_AUTOSTART = "0";
    const { chmodSync } = await import("node:fs");
    const { setSessionCwd } = await import("../sessions.ts");
    const { insertMessageRow, getMessage } = await import("../messages.ts");
    const { drizzleDb } = await import("../db/index.ts");
    const { claudeDeliveryJobs } = await import("../db/drizzle-schema.ts");
    const { eq } = await import("drizzle-orm");
    const {
      claimClaudeDeliveryJobForWorker,
      enqueueClaudeDeliveryJob,
      failClaudeDeliveryJobFromWorker,
    } = await import("./durable-delivery.ts");

    const claimSessionId = "cc_00000000-0000-0000-0000-0000000000aa";
    setSessionCwd(claimSessionId, cwd);
    const projectsRoot = path.join(stateRoot, ".claude", "projects");
    mkdirSync(projectsRoot, { recursive: true });
    // Force the scan path: no cwd transcript, projects root exists but is unreadable.
    chmodSync(projectsRoot, 0o000);

    const message = insertMessageRow({
      sessionId: claimSessionId,
      text: "readdir failure claim",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    enqueueClaudeDeliveryJob({
      messageId: message.id,
      messageSessionId: claimSessionId,
      claudeSessionId: claimSessionId,
      kind: "direct_user_message",
    });

    try {
      const claimed = await claimClaudeDeliveryJobForWorker("claim-readdir-fail", claimSessionId);
      expect(claimed).not.toBeNull();
      expect(claimed?.claude.sessionFlag[0]).toBe("--session-id");
      // Lease was claimed successfully (not a defect). Fail it so it is not left for stale recovery.
      expect(await failClaudeDeliveryJobFromWorker(claimed!.job, "test cleanup")).toBe(true);
      const job = drizzleDb
        .select()
        .from(claudeDeliveryJobs)
        .where(eq(claudeDeliveryJobs.id, claimed!.job.id))
        .get();
      expect(job?.status).toBe("failed");
      expect(job?.lockedAt).toBeNull();
      expect(getMessage(message.id)?.opencodeDeliveryStatus).toBe("failed");
    } finally {
      chmodSync(projectsRoot, 0o755);
    }
  });
});
