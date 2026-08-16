import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  buildPaseoCommand,
  listPaseoChatRooms,
  listPaseoSessions,
  PaseoCommandError,
  paseoChatPostArgs,
  paseoChatWaitArgs,
  paseoSessionMatchesWorkspace,
  runPaseoCommand,
} from "./client.ts";

const dirs: string[] = [];

describe("Paseo CLI client", () => {
  const originalPaseoBin = process.env.SAY_TO_ME_PASEO_BIN;
  const originalPaseoHome = process.env.SAY_TO_ME_PASEO_HOME;
  afterEach(() => {
    if (originalPaseoBin === undefined) delete process.env.SAY_TO_ME_PASEO_BIN;
    else process.env.SAY_TO_ME_PASEO_BIN = originalPaseoBin;
    if (originalPaseoHome === undefined) delete process.env.SAY_TO_ME_PASEO_HOME;
    else process.env.SAY_TO_ME_PASEO_HOME = originalPaseoHome;
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  function tempDir() {
    const dir = mkdtempSync(path.join(tmpdir(), "paseo-test-"));
    dirs.push(dir);
    return dir;
  }

  it("uses packaged and checkout command forms without a shell", async () => {
    const checkout = tempDir();
    mkdirSync(path.join(checkout, "scripts"), { recursive: true });
    mkdirSync(path.join(checkout, "packages/cli/src"), { recursive: true });
    mkdirSync(path.join(checkout, "node_modules/express"), { recursive: true });
    writeFileSync(path.join(checkout, "scripts/dev-home.sh"), "#!/bin/sh\n");
    writeFileSync(path.join(checkout, "packages/cli/src/index.ts"), "export {};\n");
    writeFileSync(path.join(checkout, "node_modules/express/package.json"), '{"name":"express"}\n');
    expect(await buildPaseoCommand({ id: "a", host: "127.0.0.1:6767" }, ["ls"])).toMatchObject({
      args: ["ls"],
    });
    expect(
      (await buildPaseoCommand({ id: "a", host: "127.0.0.1:6767" }, ["ls"])).env.PASEO_AGENT_ID,
    ).toBe("say-to-me");
    expect(paseoChatWaitArgs("room", "host")).toEqual([
      "chat",
      "wait",
      "--json",
      "--host",
      "host",
      "--timeout",
      "30s",
      "room",
    ]);
    expect(
      await buildPaseoCommand({ id: "a", binPath: checkout, host: "host" }, ["ls", "--json"]),
    ).toMatchObject({
      command: path.join(checkout, "scripts/dev-home.sh"),
      args: ["npx", "tsx", path.join(checkout, "packages/cli/src/index.ts"), "--json", "ls"],
      checkoutCwd: checkout,
    });
  });

  it("falls back from a broken checkout binPath to SAY_TO_ME_PASEO_BIN", async () => {
    const broken = tempDir();
    const bin = path.join(tempDir(), "paseo");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    process.env.SAY_TO_ME_PASEO_BIN = bin;
    process.env.SAY_TO_ME_PASEO_HOME = "~/paseo-home-override";
    const built = await buildPaseoCommand({ id: "a", binPath: broken, host: "host" }, ["ls"]);
    expect(built.command).toBe(bin);
    expect(built.env.PASEO_HOME).toBe(path.join(process.env.HOME ?? "", "paseo-home-override"));
  });

  it("uses SAY_TO_ME_PASEO_BIN when instance binPath is empty", async () => {
    const bin = path.join(tempDir(), "paseo");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    process.env.SAY_TO_ME_PASEO_BIN = bin;
    expect(await buildPaseoCommand({ id: "a", host: "host" }, ["ls"])).toMatchObject({
      command: bin,
    });
  });

  it("discovers UUID sessions from JSON with the configured host", async () => {
    const dir = tempDir();
    const bin = path.join(dir, "paseo");
    const argsFile = path.join(dir, "args.json");
    writeFileSync(
      bin,
      `#!/bin/sh\nprintf '%s\\n' '[{"id":"11111111-1111-4111-8111-111111111111","title":"Agent","cwd":"~/work"}]'\nprintf '%s' "$@" > "${argsFile}"\n`,
    );
    chmodSync(bin, 0o755);
    const sessions = await listPaseoSessions({ id: "local", binPath: bin, host: "127.0.0.1:6767" });
    expect(sessions[0]).toMatchObject({
      sessionId: "pa_11111111-1111-4111-8111-111111111111",
      title: "Agent",
      cwd: path.join(process.env.HOME ?? "", "work"),
    });
    expect(readFileSync(argsFile, "utf8")).toContain("--host");
  });

  it("discovers chat rooms as pc_ sessions", async () => {
    const dir = tempDir();
    const bin = path.join(dir, "paseo");
    writeFileSync(
      bin,
      `#!/bin/sh
if [ "$1" = "chat" ]; then
  printf '%s\n' '[{"id":"22222222-2222-4222-8222-222222222222","name":"Coordination","lastMessageAt":"2026-08-02T00:00:00.000Z"}]'
else
  printf '%s\n' '[]'
fi
`,
    );
    chmodSync(bin, 0o755);
    const chats = await listPaseoChatRooms({ id: "local", binPath: bin, host: "127.0.0.1:6767" });
    expect(chats).toEqual([
      expect.objectContaining({
        sessionId: "pc_22222222-2222-4222-8222-222222222222",
        chatId: "22222222-2222-4222-8222-222222222222",
        title: "Coordination",
      }),
    ]);
  });

  it("posts chat bodies after a -- terminator so option-like text stays literal", async () => {
    const dir = tempDir();
    const bin = path.join(dir, "paseo");
    const output = path.join(dir, "args");
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n<ARG>\\n' "$@" > "${output}"\n`);
    chmodSync(bin, 0o755);
    const uuid = "22222222-2222-4222-8222-222222222222";
    await runPaseoCommand(
      { id: "local", binPath: bin, host: "127.0.0.1:6767" },
      paseoChatPostArgs(uuid, "- fix the tests\n- rerun CI", "127.0.0.1:6767"),
    );
    const received = readFileSync(output, "utf8").split("\n<ARG>\n").slice(0, -1);
    expect(received).toEqual([
      "chat",
      "post",
      "--json",
      "--host",
      "127.0.0.1:6767",
      "--",
      uuid,
      "- fix the tests\n- rerun CI",
    ]);
  });

  it("keeps a literal --json body when rewriting args for a checkout CLI", async () => {
    const checkout = tempDir();
    mkdirSync(path.join(checkout, "scripts"), { recursive: true });
    mkdirSync(path.join(checkout, "packages/cli/src"), { recursive: true });
    mkdirSync(path.join(checkout, "node_modules/express"), { recursive: true });
    writeFileSync(path.join(checkout, "scripts/dev-home.sh"), "#!/bin/sh\n");
    writeFileSync(path.join(checkout, "packages/cli/src/index.ts"), "export {};\n");
    writeFileSync(path.join(checkout, "node_modules/express/package.json"), '{"name":"express"}\n');
    const uuid = "22222222-2222-4222-8222-222222222222";
    const built = await buildPaseoCommand(
      { id: "a", binPath: checkout, host: "host" },
      paseoChatPostArgs(uuid, "--json", "host"),
    );
    expect(built.args).toEqual([
      "npx",
      "tsx",
      path.join(checkout, "packages/cli/src/index.ts"),
      "--json",
      "chat",
      "post",
      "--host",
      "host",
      "--",
      uuid,
      "--json",
    ]);
  });

  it("passes arguments literally", async () => {
    const dir = tempDir();
    const bin = path.join(dir, "paseo");
    const output = path.join(dir, "args");
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${output}"\n`);
    chmodSync(bin, 0o755);
    await runPaseoCommand({ id: "local", binPath: bin, host: "host; touch /tmp/nope" }, [
      "ls",
      "--host",
      "host; touch /tmp/nope",
    ]);
    expect(readFileSync(output, "utf8")).toContain("host; touch /tmp/nope");
  });

  it("matches sessions without a cwd and canonical workspace paths", () => {
    const workspace = tempDir();
    expect(paseoSessionMatchesWorkspace({ cwd: workspace }, workspace)).toBe(true);
    expect(paseoSessionMatchesWorkspace({ cwd: null }, workspace)).toBe(true);
  });

  it("bounds a hung command and marks its outcome ambiguous", async () => {
    const dir = tempDir();
    const bin = path.join(dir, "paseo");
    writeFileSync(bin, "#!/bin/sh\nsleep 10\n");
    chmodSync(bin, 0o755);
    await expect(
      runPaseoCommand({ id: "local", binPath: bin, host: "host" }, ["send"], {
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({
      name: PaseoCommandError.name,
      retryable: false,
    });
  });

  it.skipIf(process.platform === "win32")(
    "kills descendants when a wrapper times out",
    async () => {
      const dir = tempDir();
      const bin = path.join(dir, "paseo");
      const marker = path.join(dir, "child-finished");
      writeFileSync(bin, `#!/bin/sh\n(sleep 0.2; touch "${marker}") &\nwait\n`);
      chmodSync(bin, 0o755);
      await expect(
        runPaseoCommand({ id: "local", binPath: bin, host: "host" }, ["send"], {
          timeoutMs: 20,
        }),
      ).rejects.toBeInstanceOf(PaseoCommandError);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(existsSync(marker)).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "kills a TERM-ignoring descendant after its wrapper exits",
    async () => {
      const dir = tempDir();
      const bin = path.join(dir, "paseo");
      const marker = path.join(dir, "child-finished");
      writeFileSync(bin, `#!/bin/sh\n(sh -c 'trap "" TERM; sleep 2; touch "${marker}"') &\nwait\n`);
      chmodSync(bin, 0o755);
      await expect(
        runPaseoCommand({ id: "local", binPath: bin, host: "host" }, ["send"], {
          timeoutMs: 20,
        }),
      ).rejects.toBeInstanceOf(PaseoCommandError);
      await new Promise((resolve) => setTimeout(resolve, 1_300));
      expect(existsSync(marker)).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "kills a background child after the wrapper exits before timeout",
    async () => {
      const dir = tempDir();
      const bin = path.join(dir, "paseo");
      const marker = path.join(dir, "child-finished");
      writeFileSync(bin, `#!/bin/sh\n(sleep 2; touch "${marker}") &\nexit 0\n`);
      chmodSync(bin, 0o755);
      await expect(
        runPaseoCommand({ id: "local", binPath: bin, host: "host" }, ["send"], {
          timeoutMs: 20,
        }),
      ).rejects.toBeInstanceOf(PaseoCommandError);
      await new Promise((resolve) => setTimeout(resolve, 1_300));
      expect(existsSync(marker)).toBe(false);
    },
  );
});
