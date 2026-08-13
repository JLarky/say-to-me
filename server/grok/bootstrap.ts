import { spawn } from "node:child_process";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { EXTERNAL_CLI_BOOTSTRAP_PROMPT } from "../external-cli/bootstrap-prompt.ts";
import { workerBin } from "../external-cli/worker-env.ts";

const GrokBootstrapJson = arktype({
  "sessionId?": "string",
  "text?": "string",
  "result?": "string",
});

export function grokBootstrapCommandArgs(prompt: string, model?: string): string[] {
  const args = ["--single", prompt, "--output-format", "json", "--always-approve"];
  if (model) args.push("--model", model);
  return args;
}

/** Parse Grok headless JSON (or fallback text) for the new session UUID. */
export function parseGrokStartedSessionId(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  const parsed = safeJsonParse(GrokBootstrapJson, trimmed);
  if (parsed?.sessionId?.trim()) return parsed.sessionId.trim();

  // Streaming / multi-line: last JSON object with sessionId wins.
  for (const line of trimmed.split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    const lineParsed = safeJsonParse(GrokBootstrapJson, line);
    if (lineParsed?.sessionId?.trim()) return lineParsed.sessionId.trim();
  }

  return (
    trimmed.match(/"sessionId"\s*:\s*"([0-9a-f]{8}-[0-9a-f-]{27})"/i)?.[1] ??
    trimmed.match(/\bsession id:\s*([0-9a-f]{8}-[0-9a-f-]{27})/i)?.[1] ??
    null
  );
}

export type BootstrapGrokSessionInput = {
  cwd: string;
  model?: string;
  prompt?: string;
};

/**
 * Start a new Grok session via headless single-turn (not resume) and return the
 * real session UUID. Used at CLI session create so delivery can always `--resume`.
 */
export function bootstrapGrokSession(input: BootstrapGrokSessionInput): Promise<string> {
  const prompt = input.prompt ?? EXTERNAL_CLI_BOOTSTRAP_PROMPT;
  const args = grokBootstrapCommandArgs(prompt, input.model);
  return new Promise((resolve, reject) => {
    const child = spawn(workerBin("GROK", "grok"), args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let stdout = "";
    let stderr = "";

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      settle(() => reject(error));
    });
    child.on("close", (code) => {
      settle(() => {
        const sessionId = parseGrokStartedSessionId(stdout);
        if (sessionId) {
          resolve(sessionId);
          return;
        }
        const detail = stderr.trim() || stdout.trim() || `exit code ${code ?? "?"}`;
        reject(new Error(`Grok bootstrap failed: ${detail}`));
      });
    });
  });
}
