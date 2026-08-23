export type ExternalCliWorkerEnvPrefix = "CLAUDE" | "CURSOR" | "CODEX" | "GROK";

/**
 * Increment when the server/worker protocol or worker behavior changes in a way
 * that makes already-running Boo workers unsafe or incompatible. Stale idle
 * workers exit after a version mismatch so Say To Me can start a fresh worker.
 *
 * Current generation writes the dispatch marker before prompting a provider. A
 * worker from an earlier generation does not, so it would still double-prompt
 * and must be retired rather than left running. Cursor workers at this version
 * stream `cursor-agent -p` output and idle only when that child exits.
 */
export const WORKER_VERSIONS: Record<ExternalCliWorkerEnvPrefix, number> = {
  CLAUDE: 4,
  CODEX: 2,
  GROK: 3,
  CURSOR: 4,
};

export function workerVersion(prefix: ExternalCliWorkerEnvPrefix): number {
  return WORKER_VERSIONS[prefix];
}

function envName(prefix: ExternalCliWorkerEnvPrefix, suffix: string): string {
  return `SAY_TO_ME_${prefix}_${suffix}`;
}

/** Env var name passed to spawned workers for `WORKER_MODE`. */
export function workerModeEnvName(prefix: ExternalCliWorkerEnvPrefix): string {
  return envName(prefix, "WORKER_MODE");
}

/** JSON body field for worker claim requests, e.g. `codexSessionId`. */
export function sessionIdRequestField(prefix: ExternalCliWorkerEnvPrefix): string {
  return `${prefix.toLowerCase()}SessionId`;
}

/** Default for hand-run delivery scripts: echo unless explicitly overridden. */
export function workerMode(prefix: ExternalCliWorkerEnvPrefix): string {
  return process.env[envName(prefix, "WORKER_MODE")] ?? "echo";
}

/** Boo autostart passes the real CLI mode when the env var is unset. */
export function autostartWorkerMode(prefix: ExternalCliWorkerEnvPrefix, realMode: string): string {
  return process.env[envName(prefix, "WORKER_MODE")] ?? realMode;
}

export function isRealWorkerMode(prefix: ExternalCliWorkerEnvPrefix, realMode: string): boolean {
  return workerMode(prefix) === realMode;
}

export function echoAcceptDelay(prefix: ExternalCliWorkerEnvPrefix): `${number} millis` {
  const delayMs = Number(process.env[envName(prefix, "ECHO_ACCEPT_DELAY_MS")] ?? "10000");
  return `${Number.isFinite(delayMs) ? delayMs : 10000} millis`;
}

export function echoReplyDelayMs(prefix: ExternalCliWorkerEnvPrefix): number {
  const delayMs = Number(
    process.env[envName(prefix, "ECHO_REPLY_DELAY_MS")] ??
      process.env[envName(prefix, "ECHO_DELAY_MS")] ??
      "60000",
  );
  return Number.isFinite(delayMs) ? delayMs : 60000;
}

export function echoFailBeforeAccept(prefix: ExternalCliWorkerEnvPrefix): boolean {
  return process.env[envName(prefix, "ECHO_FAIL_BEFORE_ACCEPT")] === "1";
}

export function workerAutostartDisabled(prefix: ExternalCliWorkerEnvPrefix): boolean {
  return process.env[envName(prefix, "WORKER_AUTOSTART")] === "0";
}

export function workerBin(prefix: ExternalCliWorkerEnvPrefix, defaultBin: string): string {
  return process.env[envName(prefix, "BIN")] ?? defaultBin;
}
