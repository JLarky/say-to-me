#!/usr/bin/env node
import { createInterface } from "node:readline";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";
import { BooDriver } from "./driver.ts";

type JsonRpcRequest = {
  id?: number | string | null;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
};

type ToolCall = {
  arguments?: Record<string, unknown>;
  name?: string;
};

type JsonRpcResult = object | string;

const JsonRpcRequestSchema = arktype({
  "id?": "number | string | null",
  "jsonrpc?": "string",
  "method?": "string",
  "params?": "unknown",
});

const driver = new BooDriver();

const tools = [
  {
    name: "boo_list_sessions",
    description: "List Boo sessions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "boo_start_agent",
    description: "Start a Claude or Codex agent inside a detached Boo session.",
    inputSchema: {
      type: "object",
      required: ["name", "agent", "cwd"],
      properties: {
        agent: { type: "string", enum: ["claude", "codex"] },
        cwd: { type: "string" },
        launcher: { type: "string", enum: ["cl", "claude", "cx", "codex"] },
        name: { type: "string" },
        timeout: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "boo_send_prompt",
    description:
      "Safely clear stale input, type a prompt, submit it, wait for idle, and return the screen.",
    inputSchema: {
      type: "object",
      required: ["name", "prompt"],
      properties: {
        name: { type: "string" },
        prompt: { type: "string" },
        timeout: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "boo_send_key",
    description: "Send a named key such as C-u, C-c, Enter, or Space to a Boo session.",
    inputSchema: {
      type: "object",
      required: ["name", "key"],
      properties: { key: { type: "string" }, name: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "boo_send_text",
    description: "Type text into a Boo session, optionally pressing Enter.",
    inputSchema: {
      type: "object",
      required: ["name", "text"],
      properties: {
        enter: { type: "boolean" },
        name: { type: "string" },
        text: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "boo_wait_idle",
    description: "Wait until a Boo session has been idle for two seconds.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" }, timeout: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "boo_kill_session",
    description: "Kill a Boo session.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "boo_peek",
    description: "Read a Boo session screen.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" }, scrollback: { type: "boolean" } },
      additionalProperties: false,
    },
  },
];

const input = createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  if (line.trim().length === 0) return;
  const request = safeJsonParse(JsonRpcRequestSchema, line);
  if (!request || request.id == null) return;
  try {
    const result = await handleRequest(request);
    write({ id: request.id, jsonrpc: "2.0", result });
  } catch (error) {
    write({
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      id: request.id,
      jsonrpc: "2.0",
    });
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResult> {
  if (request.method === "initialize") {
    return {
      capabilities: { tools: {} },
      protocolVersion: "2024-11-05",
      serverInfo: { name: "say-to-me-boo", version: "0.1.0" },
    };
  }
  if (request.method === "tools/list") return { tools };
  if (request.method === "tools/call")
    return toolResult(await callTool(asToolCall(request.params)));
  throw new Error(`Unsupported method: ${request.method ?? "unknown"}`);
}

async function callTool(call: ToolCall): Promise<JsonRpcResult> {
  const args = call.arguments ?? {};
  if (call.name === "boo_list_sessions") return driver.listSessions();
  if (call.name === "boo_start_agent") {
    return driver.startAgent({
      agent: requiredString(args, "agent") as "claude" | "codex",
      cwd: requiredString(args, "cwd"),
      launcher: optionalString(args, "launcher") as "cl" | "claude" | "cx" | "codex" | undefined,
      name: requiredString(args, "name"),
      waitTimeout: optionalString(args, "timeout"),
    });
  }
  if (call.name === "boo_send_prompt") {
    return driver.sendPrompt({
      name: requiredString(args, "name"),
      prompt: requiredString(args, "prompt"),
      waitTimeout: optionalString(args, "timeout"),
    });
  }
  if (call.name === "boo_send_key") {
    await driver.sendKey(requiredString(args, "name"), requiredString(args, "key"));
    return { ok: true };
  }
  if (call.name === "boo_send_text") {
    await driver.sendText(requiredString(args, "name"), requiredString(args, "text"), {
      enter: args.enter === true,
    });
    return { ok: true };
  }
  if (call.name === "boo_wait_idle") {
    await driver.waitIdle(requiredString(args, "name"), optionalString(args, "timeout") ?? "30s");
    return { ok: true };
  }
  if (call.name === "boo_kill_session") {
    return { output: await driver.killSession(requiredString(args, "name")) };
  }
  if (call.name === "boo_peek") {
    return {
      screen: await driver.peek(requiredString(args, "name"), {
        scrollback: args.scrollback === true,
      }),
    };
  }
  throw new Error(`Unsupported tool: ${call.name ?? "unknown"}`);
}

function asToolCall(value: unknown): ToolCall {
  if (typeof value !== "object" || value == null) throw new Error("Expected tool call params");
  return value as ToolCall;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (value == null || value.length === 0) throw new Error(`Missing ${key}`);
  return value;
}

function toolResult(value: JsonRpcResult): object {
  return { content: [{ text: JSON.stringify(value, null, 2), type: "text" }] };
}

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
