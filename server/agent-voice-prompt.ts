import {
  resolveAgentCliServerUrl,
  type ResolveWorkerInternalUrlOptions,
} from "./external-cli/worker-internal-url.ts";

export function buildAgentVoicePrompt(
  sessionId: string,
  body: string,
  options?: ResolveWorkerInternalUrlOptions,
): string {
  const server = resolveAgentCliServerUrl(options);
  const serverLine = server
    ? `\nThis session requires \`say-to-me api --server ${server}\` on every call. Do not use say.local.`
    : "";
  return `you have to reply to this message with voice (cli \`say-to-me usage\` to learn how/why)${serverLine}\n\n${sessionId} says: ${body}`;
}
