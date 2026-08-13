export type SseClient = {
  write: (chunk: string) => void | Promise<void>;
  close?: () => void;
};

export const sseRetryLine = "retry: 3000\n\n";

export function ssePingFrame(): string {
  return "event: ping\ndata: {}\n\n";
}

export function sseSnapshotFrame(payload: { revision?: number } & Record<string, unknown>): string {
  const revision = Number.isInteger(payload.revision) ? payload.revision : 0;
  return `id: ${revision}\nevent: snapshot\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function formatSseEvent(payload: unknown, eventName?: string): string {
  const lines: string[] = [];
  if (eventName) lines.push(`event: ${eventName}`);
  lines.push(`data: ${JSON.stringify(payload)}`);
  return `${lines.join("\n")}\n\n`;
}

export function writeSseEvent(client: SseClient, payload: unknown, eventName?: string): void {
  void client.write(formatSseEvent(payload, eventName));
}

export function startSseHeartbeat(client: SseClient, intervalMs = 15_000): () => void {
  const interval = setInterval(() => {
    void client.write(ssePingFrame());
  }, intervalMs);
  return () => clearInterval(interval);
}
