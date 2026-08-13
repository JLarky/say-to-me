import type { WorkerDriver } from "../boo/schedule-worker-replacement.ts";
import { createExternalCliBooWorker, type ExternalCliBooWorkerConfig } from "./boo-worker.ts";

export type { ExternalCliBooWorkerConfig };

const claudeBooWorker = createExternalCliBooWorker({
  envPrefix: "CLAUDE",
  realWorkerMode: "claude",
  workerScriptName: "claude-delivery-worker.ts",
});

const codexBooWorker = createExternalCliBooWorker({
  envPrefix: "CODEX",
  realWorkerMode: "codex",
  workerScriptName: "codex-delivery-worker.ts",
});

const grokBooWorker = createExternalCliBooWorker({
  envPrefix: "GROK",
  realWorkerMode: "grok",
  workerScriptName: "grok-delivery-worker.ts",
});

const cursorBooWorker = createExternalCliBooWorker({
  envPrefix: "CURSOR",
  realWorkerMode: "cursor",
  workerScriptName: "cursor-delivery-worker.ts",
});

export const claudeBooWorkerName = claudeBooWorker.booWorkerName;
export const codexBooWorkerName = codexBooWorker.booWorkerName;
export const grokBooWorkerName = grokBooWorker.booWorkerName;
export const cursorBooWorkerName = cursorBooWorker.booWorkerName;

export async function ensureClaudeBooWorker(
  sessionId: string,
  driver?: WorkerDriver,
): Promise<boolean> {
  return claudeBooWorker.ensureBooWorker(sessionId, driver);
}

export async function ensureCodexBooWorker(
  sessionId: string,
  driver?: WorkerDriver,
): Promise<boolean> {
  return codexBooWorker.ensureBooWorker(sessionId, driver);
}

export async function ensureGrokBooWorker(
  sessionId: string,
  driver?: WorkerDriver,
): Promise<boolean> {
  return grokBooWorker.ensureBooWorker(sessionId, driver);
}

export async function ensureCursorBooWorker(
  sessionId: string,
  driver?: WorkerDriver,
): Promise<boolean> {
  return cursorBooWorker.ensureBooWorker(sessionId, driver);
}

export type ReplacementOptions = {
  driver?: WorkerDriver;
  intervalMs?: number;
  maxAttempts?: number;
};

export async function scheduleClaudeBooWorkerReplacement(
  sessionId: string,
  options: ReplacementOptions = {},
): Promise<void> {
  return claudeBooWorker.scheduleBooWorkerReplacement(sessionId, options);
}

export async function scheduleCodexBooWorkerReplacement(
  sessionId: string,
  options: ReplacementOptions = {},
): Promise<void> {
  return codexBooWorker.scheduleBooWorkerReplacement(sessionId, options);
}

export async function scheduleGrokBooWorkerReplacement(
  sessionId: string,
  options: ReplacementOptions = {},
): Promise<void> {
  return grokBooWorker.scheduleBooWorkerReplacement(sessionId, options);
}

export async function scheduleCursorBooWorkerReplacement(
  sessionId: string,
  options: ReplacementOptions = {},
): Promise<void> {
  return cursorBooWorker.scheduleBooWorkerReplacement(sessionId, options);
}
