export function buildAgentVoicePrompt(sessionId: string, body: string): string {
  return `you have to reply to this message with voice (cli \`say-to-me usage\` to learn how/why)\n\n${sessionId} says: ${body}`;
}
