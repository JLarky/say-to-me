import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeJsonParse, JsonUnknownArray } from "@say-to-me/runtime-validation";

const execFileAsync = promisify(execFile);

export type BooAgentKind = "claude" | "codex";
export type BooLauncher = "cl" | "claude" | "cx" | "codex";

type ExecResult = {
  stdout: string;
  stderr: string;
};

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Boo CLI JSON is external process output, narrowed to the optional session fields below.
type BooSessionCandidate = Record<string, unknown>;

export type BooSession = {
  attached?: boolean;
  idle_ms?: number;
  name: string;
  title?: string;
};

export type BooDriverOptions = {
  booPath?: string;
  exec?: (file: string, args: string[], options?: { cwd?: string }) => Promise<ExecResult>;
};

export type StartAgentOptions = {
  agent: BooAgentKind;
  cwd: string;
  launcher?: BooLauncher;
  name: string;
  waitTimeout?: string;
};

export type SendPromptOptions = {
  clearFirst?: boolean;
  name: string;
  prompt: string;
  submitRetries?: number;
  waitTimeout?: string;
};

export type StartCommandOptions = {
  args: string[];
  cwd?: string;
  name: string;
};

export type SendPromptResult = {
  afterType: string;
  finalScreen: string;
  retriesUsed: number;
};

export class BooDriver {
  #booPath: string;
  #exec: NonNullable<BooDriverOptions["exec"]>;

  constructor(options: BooDriverOptions = {}) {
    this.#booPath = options.booPath ?? process.env.BOO_BIN ?? "boo";
    this.#exec = options.exec ?? defaultExec;
  }

  async killSession(name: string): Promise<string> {
    const result = await this.#run(["kill", name]);
    return result.stdout;
  }

  async listSessions(): Promise<BooSession[]> {
    const result = await this.#run(["ls", "--json"]);
    if (result.stdout.trim().length === 0) return [];
    const parsed = safeJsonParse(JsonUnknownArray, result.stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => (isBooSession(item) ? [item] : []));
  }

  async peek(name: string, options: { scrollback?: boolean } = {}): Promise<string> {
    const args = ["peek", name];
    if (options.scrollback) args.push("--scrollback");
    const result = await this.#run(args);
    return result.stdout;
  }

  async sendKey(name: string, key: string): Promise<void> {
    await this.#run(["send", name, "--key", key]);
  }

  async sendText(name: string, text: string, options: { enter?: boolean } = {}): Promise<void> {
    const args = ["send", name, "--text", text];
    if (options.enter) args.push("--enter");
    await this.#run(args);
  }

  async startAgent(options: StartAgentOptions): Promise<string> {
    const launcher = options.launcher ?? defaultLauncherFor(options.agent);
    const command = commandForLauncher(launcher);
    await this.#run(["new", options.name, "-d", "--", ...command], { cwd: options.cwd });
    await this.waitIdle(options.name, options.waitTimeout ?? "30s");
    return this.peek(options.name, { scrollback: true });
  }

  async startCommand(options: StartCommandOptions): Promise<string> {
    const result = await this.#run(["new", options.name, "-d", "--", ...options.args], {
      cwd: options.cwd,
    });
    return result.stdout.trim();
  }

  async sendPrompt(options: SendPromptOptions): Promise<SendPromptResult> {
    const clearFirst = options.clearFirst ?? true;
    const submitRetries = options.submitRetries ?? 1;
    if (clearFirst) await this.sendKey(options.name, "C-u");
    await this.sendText(options.name, options.prompt);
    await this.waitIdle(options.name, "5s").catch(() => undefined);
    const afterType = await this.peek(options.name, { scrollback: true });
    let retriesUsed = 0;
    let finalScreen = afterType;
    for (;;) {
      await this.sendKey(options.name, "Enter");
      await this.waitIdle(options.name, options.waitTimeout ?? "120s");
      finalScreen = await this.peek(options.name, { scrollback: true });
      if (retriesUsed >= submitRetries || !screenStillShowsPrompt(finalScreen, options.prompt)) {
        return { afterType, finalScreen, retriesUsed };
      }
      retriesUsed += 1;
    }
  }

  async waitIdle(name: string, timeout = "30s"): Promise<void> {
    await this.#run(["wait", name, "--idle", "--timeout", timeout]);
  }

  async #run(args: string[], options: { cwd?: string } = {}): Promise<ExecResult> {
    return this.#exec(this.#booPath, args, options);
  }
}

async function defaultExec(file: string, args: string[], options: { cwd?: string } = {}) {
  const result = await execFileAsync(file, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH ?? ""}` },
    maxBuffer: 1024 * 1024 * 8,
  });
  return { stderr: result.stderr, stdout: result.stdout };
}

function commandForLauncher(launcher: BooLauncher): string[] {
  if (launcher === "cl") return ["bash", "-ic", "cl"];
  return [launcher];
}

function defaultLauncherFor(agent: BooAgentKind): BooLauncher {
  if (agent === "claude") return "cl";
  return "cx";
}

function isBooSession(value: unknown): value is BooSession {
  if (typeof value !== "object" || value == null) return false;
  const candidate = value as BooSessionCandidate;
  return typeof candidate.name === "string";
}

function normalizeForSearch(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function screenStillShowsPrompt(screen: string, prompt: string): boolean {
  const compactPrompt = normalizeForSearch(prompt);
  if (compactPrompt.length === 0) return false;
  return normalizeForSearch(screen).includes(compactPrompt);
}
