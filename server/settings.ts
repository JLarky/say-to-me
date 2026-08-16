import { type as arktype } from "arktype";
import { Clock, Context, Data, Effect, Layer } from "effect";
import { eq, sql } from "drizzle-orm";
import { safeJsonParse } from "@say-to-me/runtime-validation";

import { drizzleDb } from "./db/index.ts";
import { appSettings } from "./db/drizzle-schema.ts";

const SETTINGS_ID = 1;

export const DEFAULT_PASEO_INSTANCE_ID = "default";
export const DEFAULT_PASEO_HOST = "127.0.0.1:6767";
export const DEFAULT_OPENCODE_INSTANCE_ID = "default";

/** Refresh a little early so callers rarely hit an already-expired token. */
export const ACCESS_TOKEN_EXPIRY_SKEW_MS = 30_000;

/** Public T3 instance fields safe for the settings API / frontend. */
export interface T3ServerInstance {
  id: string;
  /** T3 checkout containing apps/server/dist/bin.mjs. */
  binPath?: string;
  /** T3CODE_HOME data root (e.g. ~/.t3), not the git checkout. */
  baseDir: string;
  /** API origin for shell/auth HTTP (e.g. http://localhost:5470/). */
  originUrl: string;
  /**
   * When true, mint against the T3 `dev` state store under baseDir
   * (matches servers started with a Vite dev URL). When false, use `userdata`.
   */
  isDev: boolean;
}

/**
 * Server-only secrets for a T3 instance. Never include these in API responses
 * or client-facing settings payloads.
 */
export interface T3ServerInstanceSecrets {
  accessToken: string | null;
  /** Unix epoch milliseconds; null when no token is stored. */
  accessTokenExpiresAt: number | null;
}

/** Full stored instance (public + secrets). */
export interface T3ServerInstanceStored extends T3ServerInstance, T3ServerInstanceSecrets {}

export interface PaseoInstance {
  id: string;
  localUrl?: string;
  tailscaleUrl?: string;
  /** Paseo daemon server ID used by browser routes (auto-detected when omitted). */
  serverId?: string;
  /** Paseo executable or checkout containing the `cli` package script. */
  binPath?: string;
  /** Optional PASEO_HOME override. */
  home?: string;
  /** Paseo host, for example 127.0.0.1:6767. */
  host: string;
}

export interface OpenCodeInstance {
  id: string;
  localUrl?: string;
  tailscaleUrl?: string;
}

export interface AppSettings {
  preferredWorktreeParentPath: string | null;
  preferredJarvisParentPath: string | null;
  t3ServerInstances: T3ServerInstance[];
  paseoInstances: PaseoInstance[];
  opencodeInstances: OpenCodeInstance[];
}

export type AppSettingsPatch = {
  preferredWorktreeParentPath?: string | null;
  preferredJarvisParentPath?: string | null;
  /** Public fields only; secrets are preserved by matching instance id. */
  t3ServerInstances?: readonly T3ServerInstance[];
  paseoInstances?: readonly PaseoInstance[];
  opencodeInstances?: readonly OpenCodeInstance[];
};

export type MintedT3AccessToken = {
  accessToken: string;
  accessTokenExpiresAt: number;
};

const T3ServerInstanceStoredSchema = arktype({
  id: "string",
  "binPath?": "string",
  "baseDir?": "string",
  "originUrl?": "string",
  "isDev?": "boolean",
  "accessToken?": "string | null",
  "accessTokenExpiresAt?": "number | null",
});
const T3ServerInstancesStoredSchema = T3ServerInstanceStoredSchema.array();
const PaseoInstanceSchema = arktype({
  id: "string",
  "localUrl?": "string",
  "tailscaleUrl?": "string",
  "serverId?": "string",
  "binPath?": "string",
  "home?": "string",
  host: "string",
});
const PaseoInstancesSchema = PaseoInstanceSchema.array();
const OpenCodeInstanceSchema = arktype({
  id: "string",
  "localUrl?": "string",
  "tailscaleUrl?": "string",
});
const OpenCodeInstancesSchema = OpenCodeInstanceSchema.array();

export class SettingsValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

export class T3ServerInstanceNotFoundError extends Error {
  readonly status = 404;

  constructor(instanceId: string) {
    super(`T3 server instance "${instanceId}" was not found.`);
    this.name = "T3ServerInstanceNotFoundError";
  }
}

export class T3AccessTokenError extends Data.TaggedError("T3AccessTokenError")<{
  readonly error: string;
  readonly status: number;
}> {}

export type T3AccessTokenStoreService = {
  getValid: (instanceId: string, nowMs: number) => Effect.Effect<string | null, T3AccessTokenError>;
  set: (
    instanceId: string,
    accessToken: string,
    accessTokenExpiresAt: number,
  ) => Effect.Effect<void, T3AccessTokenError>;
};

export type T3AccessTokenIssuerService = {
  mint: () => Effect.Effect<MintedT3AccessToken, T3AccessTokenError>;
};

export const T3AccessTokenStore = Context.GenericTag<T3AccessTokenStoreService>(
  "say-to-me/T3AccessTokenStore",
);
export const T3AccessTokenIssuer = Context.GenericTag<T3AccessTokenIssuerService>(
  "say-to-me/T3AccessTokenIssuer",
);

function toPublicT3ServerInstance(instance: T3ServerInstanceStored): T3ServerInstance {
  return {
    id: instance.id,
    ...(instance.binPath ? { binPath: instance.binPath } : {}),
    baseDir: instance.baseDir,
    originUrl: instance.originUrl,
    isDev: instance.isDev,
  };
}

function normalizeOptionalToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeOptionalExpiry(value: number | null | undefined): number | null {
  if (value == null || typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function readStoredSettingsRow() {
  return drizzleDb
    .select({
      preferredWorktreeParentPath: appSettings.preferredWorktreeParentPath,
      preferredJarvisParentPath: appSettings.preferredJarvisParentPath,
      t3ServerInstances: appSettings.t3ServerInstances,
      paseoInstances: appSettings.paseoInstances,
      opencodeInstances: appSettings.opencodeInstances,
    })
    .from(appSettings)
    .where(eq(appSettings.id, SETTINGS_ID))
    .get();
}

function parseStoredT3ServerInstances(raw: string | null | undefined): T3ServerInstanceStored[] {
  if (!raw?.trim()) return [];
  const parsed = safeJsonParse(T3ServerInstancesStoredSchema, raw);
  if (!parsed) return [];
  return parsed.flatMap((entry) => {
    const id = entry.id.trim();
    if (!id) return [];
    return [
      {
        id,
        binPath: entry.binPath ?? "",
        baseDir: entry.baseDir ?? "",
        originUrl: entry.originUrl ?? "",
        isDev: entry.isDev === true,
        accessToken: normalizeOptionalToken(entry.accessToken),
        accessTokenExpiresAt: normalizeOptionalExpiry(entry.accessTokenExpiresAt),
      },
    ];
  });
}

function listStoredT3ServerInstances(): T3ServerInstanceStored[] {
  return parseStoredT3ServerInstances(readStoredSettingsRow()?.t3ServerInstances);
}

function parseStoredPaseoInstances(raw: string | null | undefined): PaseoInstance[] {
  if (!raw?.trim()) return [];
  const parsed = safeJsonParse(PaseoInstancesSchema, raw);
  if (!parsed) return [];
  return parsed.flatMap((entry) => {
    const id = entry.id.trim();
    const host = entry.host.trim();
    if (!id || !host) return [];
    const binPath = entry.binPath?.trim();
    const home = entry.home?.trim();
    const localUrl = entry.localUrl?.trim();
    const tailscaleUrl = entry.tailscaleUrl?.trim();
    return [
      {
        id,
        ...(localUrl ? { localUrl } : {}),
        ...(tailscaleUrl ? { tailscaleUrl } : {}),
        ...(binPath ? { binPath } : {}),
        ...(home ? { home } : {}),
        host,
      },
    ];
  });
}

function parseStoredOpenCodeInstances(raw: string | null | undefined): OpenCodeInstance[] {
  if (!raw?.trim()) return [];
  const parsed = safeJsonParse(OpenCodeInstancesSchema, raw);
  if (!parsed) return [];
  return parsed.flatMap((entry) => {
    const id = entry.id.trim();
    if (!id) return [];
    const localUrl = entry.localUrl?.trim();
    const tailscaleUrl = entry.tailscaleUrl?.trim();
    return [{ id, ...(localUrl ? { localUrl } : {}), ...(tailscaleUrl ? { tailscaleUrl } : {}) }];
  });
}

function effectiveOpenCodeInstances(instances: readonly OpenCodeInstance[]): OpenCodeInstance[] {
  if (instances.length > 0) return [...instances];
  const localUrl = process.env.SAY_TO_ME_OPENCODE_LOCAL_URL?.trim();
  const tailscaleUrl = process.env.SAY_TO_ME_OPENCODE_TAILSCALE_URL?.trim();
  return [
    {
      id: DEFAULT_OPENCODE_INSTANCE_ID,
      ...(localUrl ? { localUrl } : {}),
      ...(tailscaleUrl ? { tailscaleUrl } : {}),
    },
  ];
}

function effectivePaseoInstances(instances: readonly PaseoInstance[]): PaseoInstance[] {
  return instances.length > 0
    ? [...instances]
    : [{ id: DEFAULT_PASEO_INSTANCE_ID, host: DEFAULT_PASEO_HOST }];
}

function writeAppSettingsRow(input: {
  preferredWorktreeParentPath: string | null;
  preferredJarvisParentPath: string | null;
  t3ServerInstances: readonly T3ServerInstanceStored[];
  paseoInstances: readonly PaseoInstance[];
  opencodeInstances: readonly OpenCodeInstance[];
}): void {
  const t3ServerInstancesJson = JSON.stringify(input.t3ServerInstances);
  const paseoInstancesJson = JSON.stringify(input.paseoInstances);
  const opencodeInstancesJson = JSON.stringify(input.opencodeInstances);
  drizzleDb
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      preferredWorktreeParentPath: input.preferredWorktreeParentPath,
      preferredJarvisParentPath: input.preferredJarvisParentPath,
      t3ServerInstances: t3ServerInstancesJson,
      paseoInstances: paseoInstancesJson,
      opencodeInstances: opencodeInstancesJson,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        preferredWorktreeParentPath: input.preferredWorktreeParentPath,
        preferredJarvisParentPath: input.preferredJarvisParentPath,
        t3ServerInstances: t3ServerInstancesJson,
        paseoInstances: paseoInstancesJson,
        opencodeInstances: opencodeInstancesJson,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    })
    .run();
}

export function getAppSettings(): AppSettings {
  const settings = readStoredSettingsRow();
  return {
    preferredWorktreeParentPath: settings?.preferredWorktreeParentPath ?? null,
    preferredJarvisParentPath: settings?.preferredJarvisParentPath ?? null,
    t3ServerInstances: listStoredT3ServerInstances().map(toPublicT3ServerInstance),
    paseoInstances: effectivePaseoInstances(parseStoredPaseoInstances(settings?.paseoInstances)),
    opencodeInstances: effectiveOpenCodeInstances(
      parseStoredOpenCodeInstances(settings?.opencodeInstances),
    ),
  };
}

function normalizeSettingPath(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Normalize public instance fields from a client patch.
 * Any client-supplied secret fields are ignored so tokens cannot be set via settings API.
 */
export function normalizeT3ServerInstances(
  value: readonly T3ServerInstance[] | undefined,
  previous: readonly T3ServerInstanceStored[] = [],
): T3ServerInstanceStored[] {
  if (!Array.isArray(value)) {
    throw new SettingsValidationError("t3ServerInstances must be an array.");
  }

  const previousById = new Map(previous.map((instance) => [instance.id, instance]));
  const seen = new Set<string>();
  const instances: T3ServerInstanceStored[] = [];

  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object") {
      throw new SettingsValidationError(`T3 server instance at index ${index} is invalid.`);
    }
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) {
      throw new SettingsValidationError(`T3 server instance at index ${index} needs an id.`);
    }
    if (seen.has(id)) {
      throw new SettingsValidationError(`Duplicate T3 server instance id "${id}".`);
    }
    seen.add(id);

    const baseDir = typeof entry.baseDir === "string" ? entry.baseDir.trim() : "";
    const binPath = typeof entry.binPath === "string" ? entry.binPath.trim() : "";
    const originUrl = typeof entry.originUrl === "string" ? entry.originUrl.trim() : "";
    const isDev = entry.isDev === true;
    const prior = previousById.get(id);
    // Changing public auth-location fields invalidates a previously minted token.
    const authLocationChanged =
      !prior ||
      prior.baseDir !== baseDir ||
      prior.originUrl !== originUrl ||
      prior.isDev !== isDev ||
      prior.binPath !== binPath;

    instances.push({
      id,
      binPath,
      baseDir,
      originUrl,
      isDev,
      // Secrets are never accepted from the settings API payload.
      accessToken: authLocationChanged ? null : (prior.accessToken ?? null),
      accessTokenExpiresAt: authLocationChanged ? null : (prior.accessTokenExpiresAt ?? null),
    });
  }

  return instances;
}

export function normalizePaseoInstances(
  value: readonly PaseoInstance[] | undefined,
): PaseoInstance[] {
  if (!Array.isArray(value)) {
    throw new SettingsValidationError("paseoInstances must be an array.");
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    const host = typeof entry?.host === "string" ? entry.host.trim() : "";
    if (!id) throw new SettingsValidationError(`Paseo instance at index ${index} needs an id.`);
    if (seen.has(id)) throw new SettingsValidationError(`Duplicate Paseo instance id "${id}".`);
    if (!host) throw new SettingsValidationError(`Paseo instance "${id}" needs a host.`);
    seen.add(id);
    const binPath = typeof entry.binPath === "string" ? entry.binPath.trim() : "";
    const home = typeof entry.home === "string" ? entry.home.trim() : "";
    const serverId = typeof entry.serverId === "string" ? entry.serverId.trim() : "";
    const localUrl = typeof entry.localUrl === "string" ? entry.localUrl.trim() : "";
    const tailscaleUrl = typeof entry.tailscaleUrl === "string" ? entry.tailscaleUrl.trim() : "";
    return {
      id,
      ...(localUrl ? { localUrl } : {}),
      ...(tailscaleUrl ? { tailscaleUrl } : {}),
      ...(serverId ? { serverId } : {}),
      ...(binPath ? { binPath } : {}),
      ...(home ? { home } : {}),
      host,
    };
  });
}

export function normalizeOpenCodeInstances(
  value: readonly OpenCodeInstance[] | undefined,
): OpenCodeInstance[] {
  if (!Array.isArray(value)) {
    throw new SettingsValidationError("opencodeInstances must be an array.");
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) throw new SettingsValidationError(`OpenCode instance at index ${index} needs an id.`);
    if (seen.has(id)) throw new SettingsValidationError(`Duplicate OpenCode instance id "${id}".`);
    const localUrl = typeof entry.localUrl === "string" ? entry.localUrl.trim() : "";
    const tailscaleUrl = typeof entry.tailscaleUrl === "string" ? entry.tailscaleUrl.trim() : "";
    seen.add(id);
    return { id, ...(localUrl ? { localUrl } : {}), ...(tailscaleUrl ? { tailscaleUrl } : {}) };
  });
}

export function updateAppSettings(patch: AppSettingsPatch): AppSettings {
  const currentRow = readStoredSettingsRow();
  const currentPaths = {
    preferredWorktreeParentPath: currentRow?.preferredWorktreeParentPath ?? null,
    preferredJarvisParentPath: currentRow?.preferredJarvisParentPath ?? null,
  };
  const currentStoredInstances = parseStoredT3ServerInstances(currentRow?.t3ServerInstances);
  const currentPaseoInstances = parseStoredPaseoInstances(currentRow?.paseoInstances);
  const currentOpenCodeInstances = parseStoredOpenCodeInstances(currentRow?.opencodeInstances);

  const preferredWorktreeParentPath =
    "preferredWorktreeParentPath" in patch
      ? normalizeSettingPath(patch.preferredWorktreeParentPath)
      : currentPaths.preferredWorktreeParentPath;
  const preferredJarvisParentPath =
    "preferredJarvisParentPath" in patch
      ? normalizeSettingPath(patch.preferredJarvisParentPath)
      : currentPaths.preferredJarvisParentPath;
  const t3ServerInstances =
    "t3ServerInstances" in patch
      ? normalizeT3ServerInstances(patch.t3ServerInstances, currentStoredInstances)
      : currentStoredInstances;
  const storedPaseoInstances =
    "paseoInstances" in patch
      ? normalizePaseoInstances(patch.paseoInstances)
      : currentPaseoInstances;
  const paseoInstances = effectivePaseoInstances(storedPaseoInstances);
  const storedOpenCodeInstances =
    "opencodeInstances" in patch
      ? normalizeOpenCodeInstances(patch.opencodeInstances)
      : currentOpenCodeInstances;
  const opencodeInstances = effectiveOpenCodeInstances(storedOpenCodeInstances);

  writeAppSettingsRow({
    preferredWorktreeParentPath,
    preferredJarvisParentPath,
    t3ServerInstances,
    paseoInstances: storedPaseoInstances,
    opencodeInstances: storedOpenCodeInstances,
  });

  return {
    preferredWorktreeParentPath,
    preferredJarvisParentPath,
    t3ServerInstances: t3ServerInstances.map(toPublicT3ServerInstance),
    paseoInstances,
    opencodeInstances,
  };
}

export function getStoredT3ServerInstance(instanceId: string): T3ServerInstanceStored | null {
  const id = instanceId.trim();
  if (!id) return null;
  return listStoredT3ServerInstances().find((instance) => instance.id === id) ?? null;
}

export function getPaseoInstance(instanceId: string): PaseoInstance | null {
  const id = instanceId.trim();
  if (!id) return null;
  return getAppSettings().paseoInstances.find((instance) => instance.id === id) ?? null;
}

export function isT3AccessTokenValid(
  expiresAt: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (expiresAt == null || !Number.isFinite(expiresAt)) return false;
  return expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS > nowMs;
}

/**
 * Returns the stored access token when present and not expired.
 * Never logs or returns this value through the settings HTTP API.
 */
export function getValidT3ServerInstanceAccessToken(
  instanceId: string,
  nowMs: number = Date.now(),
): string | null {
  const instance = getStoredT3ServerInstance(instanceId);
  if (!instance?.accessToken) return null;
  if (!isT3AccessTokenValid(instance.accessTokenExpiresAt, nowMs)) return null;
  return instance.accessToken;
}

/** Server-only: persist or clear an access token for a T3 instance. */
export function setT3ServerInstanceAccessToken(
  instanceId: string,
  accessToken: string | null,
  accessTokenExpiresAt: number | null,
): T3ServerInstanceStored {
  const id = instanceId.trim();
  if (!id) {
    throw new SettingsValidationError("T3 server instance id is required.");
  }

  const currentRow = readStoredSettingsRow();
  const currentStoredInstances = parseStoredT3ServerInstances(currentRow?.t3ServerInstances);
  const index = currentStoredInstances.findIndex((instance) => instance.id === id);
  if (index < 0) {
    throw new T3ServerInstanceNotFoundError(id);
  }

  const nextToken = normalizeOptionalToken(accessToken);
  const nextExpiresAt = nextToken ? normalizeOptionalExpiry(accessTokenExpiresAt) : null;
  if (nextToken && nextExpiresAt == null) {
    throw new SettingsValidationError(
      "accessTokenExpiresAt is required when saving a T3 access token.",
    );
  }

  const updated: T3ServerInstanceStored = {
    ...currentStoredInstances[index]!,
    accessToken: nextToken,
    accessTokenExpiresAt: nextExpiresAt,
  };
  const nextInstances = currentStoredInstances.slice();
  nextInstances[index] = updated;

  writeAppSettingsRow({
    preferredWorktreeParentPath: currentRow?.preferredWorktreeParentPath ?? null,
    preferredJarvisParentPath: currentRow?.preferredJarvisParentPath ?? null,
    t3ServerInstances: nextInstances,
    paseoInstances: parseStoredPaseoInstances(currentRow?.paseoInstances),
    opencodeInstances: parseStoredOpenCodeInstances(currentRow?.opencodeInstances),
  });

  return updated;
}

export const T3AccessTokenStoreLive = Layer.succeed(T3AccessTokenStore, {
  getValid: (instanceId, nowMs) =>
    Effect.sync(() => getValidT3ServerInstanceAccessToken(instanceId, nowMs)),
  set: (instanceId, accessToken, accessTokenExpiresAt) =>
    Effect.try({
      try: () => {
        setT3ServerInstanceAccessToken(instanceId, accessToken, accessTokenExpiresAt);
      },
      catch: (cause) => {
        if (cause instanceof T3ServerInstanceNotFoundError) {
          return new T3AccessTokenError({ error: cause.message, status: 404 });
        }
        if (cause instanceof SettingsValidationError) {
          return new T3AccessTokenError({ error: cause.message, status: 400 });
        }
        return new T3AccessTokenError({
          error: cause instanceof Error ? cause.message : "Failed to save T3 access token.",
          status: 500,
        });
      },
    }),
});

export function makeT3AccessTokenIssuerLive(
  mint: () => Promise<MintedT3AccessToken>,
): Layer.Layer<T3AccessTokenIssuerService> {
  return Layer.succeed(T3AccessTokenIssuer, {
    mint: () =>
      Effect.tryPromise({
        try: mint,
        catch: (cause) =>
          new T3AccessTokenError({
            error: cause instanceof Error ? cause.message : "Failed to mint T3 access token.",
            status: 502,
          }),
      }),
  });
}

export function makeT3AccessTokenIssuerEffect(
  mint: Effect.Effect<MintedT3AccessToken, unknown>,
): Layer.Layer<T3AccessTokenIssuerService> {
  return Layer.succeed(T3AccessTokenIssuer, {
    mint: () =>
      mint.pipe(
        Effect.mapError(
          (cause) =>
            new T3AccessTokenError({
              error: cause instanceof Error ? cause.message : "Failed to mint T3 access token.",
              status: 502,
            }),
        ),
      ),
  });
}

/**
 * Prefer a non-expired stored token; otherwise mint a new one, validate it is usable
 * under the current clock + skew, save it, and return it.
 */
export function ensureT3ServerInstanceAccessTokenEffect(
  instanceId: string,
): Effect.Effect<
  string,
  T3AccessTokenError,
  T3AccessTokenStoreService | T3AccessTokenIssuerService
> {
  return Effect.gen(function* () {
    const store = yield* T3AccessTokenStore;
    const issuer = yield* T3AccessTokenIssuer;
    // First clock read is only for the cache lookup.
    const lookupNowMs = yield* Clock.currentTimeMillis;

    const existing = yield* store.getValid(instanceId, lookupNowMs);
    if (existing) return existing;

    const minted = yield* issuer.mint();
    // Mint is async; re-read time so validation matches when the issuer responded.
    const afterMintNowMs = yield* Clock.currentTimeMillis;
    const token = normalizeOptionalToken(minted.accessToken);
    const expiresAt = normalizeOptionalExpiry(minted.accessTokenExpiresAt);
    if (!token) {
      return yield* new T3AccessTokenError({
        error: "Minted T3 access token was empty.",
        status: 400,
      });
    }
    if (expiresAt == null) {
      return yield* new T3AccessTokenError({
        error: "Minted T3 access token is missing an expiration time.",
        status: 400,
      });
    }
    // Reject before save: otherwise callers would receive a token that
    // getValidT3ServerInstanceAccessToken immediately treats as unusable.
    if (!isT3AccessTokenValid(expiresAt, afterMintNowMs)) {
      return yield* new T3AccessTokenError({
        error: "Minted T3 access token expires too soon to be used.",
        status: 400,
      });
    }

    yield* store.set(instanceId, token, expiresAt);
    return token;
  });
}

/**
 * Live wrapper: uses the settings DB store and the provided issuer callback.
 * Prefer `ensureT3ServerInstanceAccessTokenEffect` in tests with fake layers + TestClock.
 */
export function ensureT3ServerInstanceAccessToken(
  instanceId: string,
  mint: () => Promise<MintedT3AccessToken>,
): Promise<string> {
  return Effect.runPromise(
    ensureT3ServerInstanceAccessTokenEffect(instanceId).pipe(
      Effect.provide(makeT3AccessTokenIssuerLive(mint)),
      Effect.provide(T3AccessTokenStoreLive),
    ),
  );
}
