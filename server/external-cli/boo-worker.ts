import path from "node:path";
import { fileURLToPath } from "node:url";
import { BooDriver } from "../boo/driver.ts";
import {
  scheduleWorkerReplacement,
  type WorkerDriver,
} from "../boo/schedule-worker-replacement.ts";
import { ensureInternalApiToken } from "../claude/internal-api-token.ts";
import { portlessCaEnvVar } from "./portless-ca.ts";
import {
  booWorkerNameForSession,
  isNonLiveAgentCliOrigin,
  resolveWorkerInternalUrl,
} from "./worker-internal-url.ts";
import {
  autostartWorkerMode,
  workerAutostartDisabled,
  workerModeEnvName,
  type ExternalCliWorkerEnvPrefix,
} from "./worker-env.ts";

export type ExternalCliBooWorkerConfig = {
  envPrefix: ExternalCliWorkerEnvPrefix;
  realWorkerMode: string;
  workerScriptName: string;
};

export function createExternalCliBooWorker(config: ExternalCliBooWorkerConfig) {
  const workerScript = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "scripts",
    config.workerScriptName,
  );

  function booWorkerName(sessionId: string): string {
    return booWorkerNameForSession(sessionId);
  }

  function workerProcessEnv(internalUrl: string): string[] {
    const env: string[] = [];
    if (internalUrl.startsWith("https:")) {
      const caEnv = portlessCaEnvVar();
      if (caEnv) env.push(caEnv);
    }
    return env;
  }

  async function ensureBooWorker(
    sessionId: string,
    driver: WorkerDriver = new BooDriver(),
  ): Promise<boolean> {
    if (workerAutostartDisabled(config.envPrefix)) return false;
    const name = booWorkerName(sessionId);
    const sessions = await driver.listSessions();
    if (sessions.some((session) => session.name === name)) return false;
    // Legacy names are machine-global and may belong to the live instance.
    // An isolated server must never kill or coexist with one.
    if (
      name !== `stm-${sessionId}` &&
      sessions.some((session) => session.name === `stm-${sessionId}`)
    ) {
      console.warn(
        `[${config.envPrefix.toLowerCase()}-boo-worker] refusing isolated worker ${name}: legacy worker stm-${sessionId} already exists`,
      );
      return false;
    }
    const internalUrl = resolveWorkerInternalUrl();
    const mode = autostartWorkerMode(config.envPrefix, config.realWorkerMode);
    const internalApiToken = ensureInternalApiToken();
    const isolatedOriginEnv = isNonLiveAgentCliOrigin(internalUrl)
      ? [`SAY_TO_ME_URL=${internalUrl}`]
      : [];
    await driver.startCommand({
      name,
      args: [
        "env",
        `SAY_TO_ME_INTERNAL_URL=${internalUrl}`,
        ...isolatedOriginEnv,
        `SAY_TO_ME_INTERNAL_API_TOKEN=${internalApiToken}`,
        `${workerModeEnvName(config.envPrefix)}=${mode}`,
        ...workerProcessEnv(internalUrl),
        process.execPath,
        workerScript,
        sessionId,
      ],
      cwd: process.cwd(),
    });
    return true;
  }

  type ReplacementOptions = {
    driver?: WorkerDriver;
    intervalMs?: number;
    maxAttempts?: number;
  };

  async function scheduleBooWorkerReplacement(
    sessionId: string,
    options: ReplacementOptions = {},
  ): Promise<void> {
    const name = booWorkerName(sessionId);
    await scheduleWorkerReplacement(
      name,
      workerAutostartDisabled(config.envPrefix),
      (driver) => ensureBooWorker(sessionId, driver),
      options,
    );
  }

  return { booWorkerName, ensureBooWorker, scheduleBooWorkerReplacement };
}
