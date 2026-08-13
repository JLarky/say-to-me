import { describe, expect, it } from "vite-plus/test";
import { BooDriver } from "./driver.ts";

type Call = {
  args: string[];
  cwd?: string;
  file: string;
};

function createDriver(outputs: string[] = []) {
  const calls: Call[] = [];
  const driver = new BooDriver({
    booPath: "/bin/boo",
    exec: async (file, args, options) => {
      calls.push({ args, cwd: options?.cwd, file });
      return { stderr: "", stdout: outputs.shift() ?? "" };
    },
  });
  return { calls, driver };
}

describe("BooDriver", () => {
  it("starts Claude through the interactive cl alias by default", async () => {
    const { calls, driver } = createDriver(["", "ready"]);

    await driver.startAgent({ agent: "claude", cwd: "/work", name: "agent-1" });

    expect(calls).toEqual([
      {
        args: ["new", "agent-1", "-d", "--", "bash", "-ic", "cl"],
        cwd: "/work",
        file: "/bin/boo",
      },
      { args: ["wait", "agent-1", "--idle", "--timeout", "30s"], file: "/bin/boo" },
      { args: ["peek", "agent-1", "--scrollback"], file: "/bin/boo" },
    ]);
  });

  it("starts Codex through cx by default", async () => {
    const { calls, driver } = createDriver(["", "ready"]);

    await driver.startAgent({ agent: "codex", cwd: "/work", name: "agent-2" });

    expect(calls[0]).toEqual({
      args: ["new", "agent-2", "-d", "--", "cx"],
      cwd: "/work",
      file: "/bin/boo",
    });
  });

  it("starts a fixed command without a shell", async () => {
    const { calls, driver } = createDriver(["worker-name\n"]);

    await expect(
      driver.startCommand({ args: ["node", "worker.js", "cc_123"], cwd: "/work", name: "worker" }),
    ).resolves.toBe("worker-name");

    expect(calls).toEqual([
      {
        args: ["new", "worker", "-d", "--", "node", "worker.js", "cc_123"],
        cwd: "/work",
        file: "/bin/boo",
      },
    ]);
  });

  it("sends control keys directly", async () => {
    const { calls, driver } = createDriver();

    await driver.sendKey("agent-1", "C-u");
    await driver.sendKey("agent-1", "C-c");

    expect(calls.map((call) => call.args)).toEqual([
      ["send", "agent-1", "--key", "C-u"],
      ["send", "agent-1", "--key", "C-c"],
    ]);
  });

  it("clears stale input before sending a prompt", async () => {
    const { calls, driver } = createDriver(["", "", "", "typed prompt", "", "", "answer"]);

    const result = await driver.sendPrompt({ name: "agent-1", prompt: "typed prompt" });

    expect(result.retriesUsed).toBe(0);
    expect(calls.map((call) => call.args)).toEqual([
      ["send", "agent-1", "--key", "C-u"],
      ["send", "agent-1", "--text", "typed prompt"],
      ["wait", "agent-1", "--idle", "--timeout", "5s"],
      ["peek", "agent-1", "--scrollback"],
      ["send", "agent-1", "--key", "Enter"],
      ["wait", "agent-1", "--idle", "--timeout", "120s"],
      ["peek", "agent-1", "--scrollback"],
    ]);
  });

  it("presses Enter again when the prompt remains on screen", async () => {
    const { calls, driver } = createDriver([
      "",
      "",
      "",
      "question",
      "",
      "",
      "question",
      "",
      "",
      "answer",
    ]);

    const result = await driver.sendPrompt({ name: "agent-1", prompt: "question" });

    expect(result.retriesUsed).toBe(1);
    expect(calls.map((call) => call.args)).toEqual([
      ["send", "agent-1", "--key", "C-u"],
      ["send", "agent-1", "--text", "question"],
      ["wait", "agent-1", "--idle", "--timeout", "5s"],
      ["peek", "agent-1", "--scrollback"],
      ["send", "agent-1", "--key", "Enter"],
      ["wait", "agent-1", "--idle", "--timeout", "120s"],
      ["peek", "agent-1", "--scrollback"],
      ["send", "agent-1", "--key", "Enter"],
      ["wait", "agent-1", "--idle", "--timeout", "120s"],
      ["peek", "agent-1", "--scrollback"],
    ]);
  });

  it("parses Boo JSON session output", async () => {
    const { driver } = createDriver([
      JSON.stringify([{ attached: false, idle_ms: 123, name: "boo-agent", title: "cx" }]),
    ]);

    await expect(driver.listSessions()).resolves.toEqual([
      { attached: false, idle_ms: 123, name: "boo-agent", title: "cx" },
    ]);
  });
});
