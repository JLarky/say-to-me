#!/usr/bin/env node
import { BooDriver, type BooAgentKind, type BooLauncher } from "./driver.ts";

type CliCommand =
  | "help"
  | "kill"
  | "list"
  | "peek"
  | "send-key"
  | "send-prompt"
  | "send-text"
  | "start-agent"
  | "wait";

const command = process.argv[2] as CliCommand | undefined;
const args = process.argv.slice(3);

if (command == null || command === "help") {
  printHelp();
  process.exit(command == null ? 1 : 0);
}

const driver = new BooDriver();

try {
  const result = await run(command, parseFlags(args));
  if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function run(commandName: CliCommand, flags: Map<string, string | boolean>) {
  if (commandName === "list") return driver.listSessions();
  if (commandName === "kill") return { output: await driver.killSession(required(flags, "name")) };
  if (commandName === "peek") {
    return {
      screen: await driver.peek(required(flags, "name"), { scrollback: flags.has("scrollback") }),
    };
  }
  if (commandName === "send-key") {
    await driver.sendKey(required(flags, "name"), required(flags, "key"));
    return { ok: true };
  }
  if (commandName === "send-text") {
    await driver.sendText(required(flags, "name"), required(flags, "text"), {
      enter: flags.has("enter"),
    });
    return { ok: true };
  }
  if (commandName === "send-prompt") {
    return driver.sendPrompt({
      name: required(flags, "name"),
      prompt: required(flags, "prompt"),
      waitTimeout: optional(flags, "timeout"),
    });
  }
  if (commandName === "wait") {
    await driver.waitIdle(required(flags, "name"), optional(flags, "timeout") ?? "30s");
    return { ok: true };
  }
  if (commandName === "start-agent") {
    return {
      screen: await driver.startAgent({
        agent: required(flags, "agent") as BooAgentKind,
        cwd: required(flags, "cwd"),
        launcher: optional(flags, "launcher") as BooLauncher | undefined,
        name: required(flags, "name"),
        waitTimeout: optional(flags, "timeout"),
      }),
    };
  }
  throw new Error(`Unknown command: ${commandName}`);
}

function parseFlags(values: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) throw new Error(`Expected flag, got ${value}`);
    const key = value.slice(2);
    const next = values[index + 1];
    if (next == null || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    index += 1;
  }
  return flags;
}

function optional(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function required(flags: Map<string, string | boolean>, key: string): string {
  const value = optional(flags, key);
  if (value == null || value.length === 0) throw new Error(`Missing --${key}`);
  return value;
}

function printHelp(): void {
  process.stdout.write(
    `booo - high-level Boo agent control\n\nCommands:\n  list\n  start-agent --name NAME --agent claude|codex --cwd PATH [--launcher cl|claude|cx|codex]\n  send-prompt --name NAME --prompt TEXT [--timeout 120s]\n  send-text --name NAME --text TEXT [--enter]\n  send-key --name NAME --key C-u|C-c|Enter|Space\n  wait --name NAME [--timeout 30s]\n  peek --name NAME [--scrollback]\n  kill --name NAME\n`,
  );
}
