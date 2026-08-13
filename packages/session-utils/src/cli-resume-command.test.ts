import { describe, expect, it } from "vite-plus/test";
import { cliResumeCommand } from "./cli-resume-command.ts";

describe("cliResumeCommand", () => {
  it("builds the current Cursor agent resume command", () => {
    expect(
      cliResumeCommand(
        {
          backend: "cursor",
          cwd: "/home/jlarky.guest/work/worktrees/say-to-me-new-jarvis",
        },
        "cur_6eb73264-ebfd-4ec9-ba02-0e682bc29341",
      ),
    ).toBe(
      "cd /home/jlarky.guest/work/worktrees/say-to-me-new-jarvis && cursor agent --resume 6eb73264-ebfd-4ec9-ba02-0e682bc29341",
    );
  });

  it("builds the Codex interactive resume command", () => {
    expect(
      cliResumeCommand(
        {
          backend: "codex",
          cwd: "/home/jlarky.guest/work/worktrees/say-to-me-new-jarvis",
        },
        "cod_6eb73264-ebfd-4ec9-ba02-0e682bc29341",
      ),
    ).toBe(
      "cd /home/jlarky.guest/work/worktrees/say-to-me-new-jarvis && codex resume 6eb73264-ebfd-4ec9-ba02-0e682bc29341",
    );
  });

  it("returns no command when the session is not resumable", () => {
    expect(cliResumeCommand(null, "cur_6eb73264-ebfd-4ec9-ba02-0e682bc29341")).toBeNull();
    expect(
      cliResumeCommand({ backend: "cursor" }, "cur_6eb73264-ebfd-4ec9-ba02-0e682bc29341"),
    ).toBeNull();
    expect(
      cliResumeCommand(
        { backend: "opencode", cwd: "/tmp" },
        "ses_6eb73264-ebfd-4ec9-ba02-0e682bc29341",
      ),
    ).toBeNull();
  });
});
