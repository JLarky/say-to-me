import { describe, expect, it } from "vite-plus/test";
import {
  codexBootstrapCommandArgs,
  parseCodexJsonError,
  parseCodexStartedThreadId,
} from "./bootstrap.ts";

describe("Codex create-time bootstrap", () => {
  it("builds codex exec bootstrap command args", () => {
    expect(codexBootstrapCommandArgs("ready", "gpt-5.4", "high")).toEqual([
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--json",
      "--model",
      "gpt-5.4",
      "-c",
      'model_reasoning_effort="high"',
      "ready",
    ]);
  });

  it("parses thread id from JSONL output", () => {
    expect(
      parseCodexStartedThreadId(
        [
          '{"type":"thread.started","thread_id":"019f47d2-902d-7853-9ef5-48a49be66484"}',
          '{"type":"turn.started"}',
        ].join("\n"),
      ),
    ).toBe("019f47d2-902d-7853-9ef5-48a49be66484");
  });

  it("parses thread id from text session id line", () => {
    expect(
      parseCodexStartedThreadId(
        ["OpenAI Codex v0.142.5", "session id: 019f47da-8685-77d2-ba50-1ee4878ecac1"].join("\n"),
      ),
    ).toBe("019f47da-8685-77d2-ba50-1ee4878ecac1");
  });

  it("parses JSONL error messages", () => {
    expect(
      parseCodexJsonError(
        [
          '{"type":"thread.started","thread_id":"019f47d2-902d-7853-9ef5-48a49be66484"}',
          '{"type":"error","message":"usage limit"}',
        ].join("\n"),
      ),
    ).toBe("usage limit");
  });
});
