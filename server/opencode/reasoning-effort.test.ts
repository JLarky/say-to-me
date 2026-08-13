import { describe, expect, it } from "vite-plus/test";
import {
  opencodeReasoningEffortCliArg,
  readOpenCodeModelReasoningEfforts,
  readOpenCodeSessionVariant,
} from "./reasoning-effort.ts";
import { buildOpenCodeCliArgs } from "./delivery.ts";

describe("OpenCode reasoning effort", () => {
  it("prefers reasoningEffort values from the provider model config", () => {
    expect(
      readOpenCodeModelReasoningEfforts({ reasoningEffort: ["balanced", "deep"] }, { low: {} }),
    ).toEqual(["balanced", "deep"]);
  });

  it("falls back to named variants and then the known CLI values", () => {
    expect(readOpenCodeModelReasoningEfforts({}, { fast: {}, careful: {} })).toEqual([
      "fast",
      "careful",
    ]);
    expect(readOpenCodeModelReasoningEfforts({})).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("builds a quoted-safe CLI argument pair and ignores empty persisted values", () => {
    expect(opencodeReasoningEffortCliArg("high")).toEqual(["--variant", "high"]);
    expect(readOpenCodeSessionVariant("  high ")).toBe("high");
    expect(readOpenCodeSessionVariant("default")).toBeNull();
    expect(readOpenCodeSessionVariant(" ")).toBeNull();
  });

  it("includes the persisted variant in CLI delivery and omits it when unset", () => {
    expect(
      buildOpenCodeCliArgs({
        baseUrl: "http://127.0.0.1:4096",
        sessionId: "ses_e946608d8f44iE5XvXLyK7tlO9",
        directory: "/repo",
        message: "hello",
        variant: "high",
      }),
    ).toEqual([
      "run",
      "--attach",
      "http://127.0.0.1:4096",
      "--session",
      "ses_e946608d8f44iE5XvXLyK7tlO9",
      "--dir",
      "/repo",
      "--variant",
      "high",
      "hello",
    ]);
    expect(
      buildOpenCodeCliArgs({
        baseUrl: "http://127.0.0.1:4096",
        sessionId: "ses_e946608d8f44iE5XvXLyK7tlO9",
        directory: "/repo",
        message: "hello",
      }),
    ).not.toContain("--variant");
  });
});
