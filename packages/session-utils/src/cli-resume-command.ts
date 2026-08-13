type CliResumeSession = {
  backend?: string;
  cwd?: string | null;
};

export function cliResumeCommand(
  session: CliResumeSession | null | undefined,
  sessionId: string | undefined,
): string | null {
  if (!session?.cwd || !sessionId) return null;
  const uuid = sessionId.includes("_") ? sessionId.slice(sessionId.indexOf("_") + 1) : sessionId;
  const cd = `cd ${session.cwd}`;
  switch (session.backend) {
    case "grok":
      return `${cd} && grok --resume ${uuid}`;
    case "claude":
      return `${cd} && claude --resume ${uuid}`;
    case "codex":
      return `${cd} && codex resume ${uuid}`;
    case "cursor":
      return `${cd} && cursor agent --resume ${uuid}`;
    default:
      return null;
  }
}
