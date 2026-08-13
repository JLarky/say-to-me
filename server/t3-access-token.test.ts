import { Cause, Duration, Effect, Exit, Layer, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  ACCESS_TOKEN_EXPIRY_SKEW_MS,
  ensureT3ServerInstanceAccessTokenEffect,
  T3AccessTokenError,
  T3AccessTokenIssuer,
  T3AccessTokenStore,
  type MintedT3AccessToken,
  type T3AccessTokenIssuerService,
  type T3AccessTokenStoreService,
} from "./settings.ts";

const NOW = 1_700_000_000_000;

function fakeStore(
  state: { token: string | null; expiresAt: number | null; sets: MintedT3AccessToken[] },
  options: { failSet?: boolean } = {},
): Layer.Layer<T3AccessTokenStoreService> {
  const service: T3AccessTokenStoreService = {
    getValid: (_instanceId, nowMs) =>
      Effect.sync(() => {
        if (!state.token || state.expiresAt == null) return null;
        if (state.expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS <= nowMs) return null;
        return state.token;
      }),
    set: (_instanceId, accessToken, accessTokenExpiresAt) =>
      Effect.gen(function* () {
        if (options.failSet) {
          return yield* new T3AccessTokenError({
            error: "store write failed",
            status: 500,
          });
        }
        state.token = accessToken;
        state.expiresAt = accessTokenExpiresAt;
        state.sets.push({ accessToken, accessTokenExpiresAt });
      }),
  };
  return Layer.succeed(T3AccessTokenStore, service);
}

function fakeIssuer(
  mint: () => MintedT3AccessToken | Promise<MintedT3AccessToken>,
  calls: { count: number },
): Layer.Layer<T3AccessTokenIssuerService> {
  const service: T3AccessTokenIssuerService = {
    mint: () =>
      Effect.tryPromise({
        try: async () => {
          calls.count += 1;
          return await mint();
        },
        catch: (cause) =>
          new T3AccessTokenError({
            error: cause instanceof Error ? cause.message : "mint failed",
            status: 502,
          }),
      }),
  };
  return Layer.succeed(T3AccessTokenIssuer, service);
}

async function runEnsure(
  store: Layer.Layer<T3AccessTokenStoreService>,
  issuer: Layer.Layer<T3AccessTokenIssuerService>,
  setTimeMs: number = NOW,
) {
  return Effect.runPromiseExit(
    Effect.gen(function* () {
      yield* TestClock.setTime(setTimeMs);
      return yield* ensureT3ServerInstanceAccessTokenEffect("default");
    }).pipe(Effect.provide(store), Effect.provide(issuer), Effect.provide(TestContext.TestContext)),
  );
}

describe("ensureT3ServerInstanceAccessTokenEffect", () => {
  it("reuses a stored token that is still valid under TestClock + skew", async () => {
    const state = {
      token: "cached-token",
      expiresAt: NOW + ACCESS_TOKEN_EXPIRY_SKEW_MS + 1,
      sets: [] as MintedT3AccessToken[],
    };
    const calls = { count: 0 };
    const exit = await runEnsure(
      fakeStore(state),
      fakeIssuer(() => {
        throw new Error("mint should not run");
      }, calls),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe("cached-token");
    expect(calls.count).toBe(0);
    expect(state.sets).toEqual([]);
  });

  it("mints and saves when the stored token is inside the skew window", async () => {
    const state = {
      token: "stale-token",
      // Exactly at the skew boundary: not usable.
      expiresAt: NOW + ACCESS_TOKEN_EXPIRY_SKEW_MS,
      sets: [] as MintedT3AccessToken[],
    };
    const calls = { count: 0 };
    const nextExpiry = NOW + ACCESS_TOKEN_EXPIRY_SKEW_MS + 60_000;
    const exit = await runEnsure(
      fakeStore(state),
      fakeIssuer(() => ({ accessToken: "  rotated  ", accessTokenExpiresAt: nextExpiry }), calls),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe("rotated");
    expect(calls.count).toBe(1);
    expect(state.token).toBe("rotated");
    expect(state.expiresAt).toBe(nextExpiry);
    expect(state.sets).toEqual([{ accessToken: "rotated", accessTokenExpiresAt: nextExpiry }]);
  });

  it("rejects an already-expired mint before saving", async () => {
    const state = {
      token: null as string | null,
      expiresAt: null as number | null,
      sets: [] as MintedT3AccessToken[],
    };
    const calls = { count: 0 };
    const exit = await runEnsure(
      fakeStore(state),
      fakeIssuer(() => ({ accessToken: "too-late", accessTokenExpiresAt: NOW - 1 }), calls),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.isDie(exit.cause)).toBe(false);
    expect([...Cause.failures(exit.cause)]).toEqual([
      new T3AccessTokenError({
        error: "Minted T3 access token expires too soon to be used.",
        status: 400,
      }),
    ]);
    expect(calls.count).toBe(1);
    expect(state.sets).toEqual([]);
    expect(state.token).toBeNull();
  });

  it("rejects a mint that only survives less than the skew window before saving", async () => {
    const state = {
      token: null as string | null,
      expiresAt: null as number | null,
      sets: [] as MintedT3AccessToken[],
    };
    const calls = { count: 0 };
    // Usable only if skew were 0; with 30s skew this must fail.
    const almostNow = NOW + ACCESS_TOKEN_EXPIRY_SKEW_MS;
    const exit = await runEnsure(
      fakeStore(state),
      fakeIssuer(() => ({ accessToken: "too-soon", accessTokenExpiresAt: almostNow }), calls),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect([...Cause.failures(exit.cause)]).toEqual([
      new T3AccessTokenError({
        error: "Minted T3 access token expires too soon to be used.",
        status: 400,
      }),
    ]);
    expect(state.sets).toEqual([]);
  });

  it("keeps rejecting after clock advances when a previously valid mint would now be unusable", async () => {
    const state = {
      token: null as string | null,
      expiresAt: null as number | null,
      sets: [] as MintedT3AccessToken[],
    };
    const calls = { count: 0 };
    // At NOW this mint is valid; after adjusting past the usable window it is not.
    const mintedExpiry = NOW + ACCESS_TOKEN_EXPIRY_SKEW_MS + 5_000;

    const first = await runEnsure(
      fakeStore(state),
      fakeIssuer(() => ({ accessToken: "ok-token", accessTokenExpiresAt: mintedExpiry }), calls),
      NOW,
    );
    expect(Exit.isSuccess(first)).toBe(true);
    expect(state.sets).toHaveLength(1);

    // Clear store so ensure must mint again; issuer still returns the same short-lived expiry.
    state.token = null;
    state.expiresAt = null;
    state.sets = [];

    const second = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        yield* TestClock.adjust(Duration.millis(ACCESS_TOKEN_EXPIRY_SKEW_MS + 1));
        return yield* ensureT3ServerInstanceAccessTokenEffect("default");
      }).pipe(
        Effect.provide(fakeStore(state)),
        Effect.provide(
          fakeIssuer(
            () => ({ accessToken: "late-token", accessTokenExpiresAt: mintedExpiry }),
            calls,
          ),
        ),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(Exit.isFailure(second)).toBe(true);
    if (!Exit.isFailure(second)) return;
    expect([...Cause.failures(second.cause)]).toEqual([
      new T3AccessTokenError({
        error: "Minted T3 access token expires too soon to be used.",
        status: 400,
      }),
    ]);
    expect(state.sets).toEqual([]);
  });

  it("re-reads Clock after mint and rejects when issuer latency crosses the skew boundary", async () => {
    const state = {
      token: null as string | null,
      expiresAt: null as number | null,
      sets: [] as MintedT3AccessToken[],
    };
    const calls = { count: 0 };
    // Valid against lookup time (NOW), but unusable after mint advances the clock.
    const mintedExpiry = NOW + ACCESS_TOKEN_EXPIRY_SKEW_MS + 5_000;
    const issuer: T3AccessTokenIssuerService = {
      mint: () =>
        Effect.gen(function* () {
          calls.count += 1;
          yield* TestClock.adjust(Duration.millis(ACCESS_TOKEN_EXPIRY_SKEW_MS + 1));
          return {
            accessToken: "latency-stale",
            accessTokenExpiresAt: mintedExpiry,
          };
        }),
    };

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        return yield* ensureT3ServerInstanceAccessTokenEffect("default");
      }).pipe(
        Effect.provide(fakeStore(state)),
        Effect.provide(Layer.succeed(T3AccessTokenIssuer, issuer)),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect([...Cause.failures(exit.cause)]).toEqual([
      new T3AccessTokenError({
        error: "Minted T3 access token expires too soon to be used.",
        status: 400,
      }),
    ]);
    expect(calls.count).toBe(1);
    expect(state.sets).toEqual([]);
    expect(state.token).toBeNull();
  });
});
