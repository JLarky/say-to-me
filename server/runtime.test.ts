import { describe, expect, it } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { ServerRuntime, scopedServerRuntime, type ServerRuntimeService } from "./runtime.ts";

describe("ServerRuntime", () => {
  it("exposes start and stop through the Effect service layer", async () => {
    const calls: string[] = [];
    const layer = Layer.succeed(ServerRuntime, {
      start: Effect.sync(() => calls.push("start")),
      stop: Effect.sync(() => calls.push("stop")),
    } satisfies ServerRuntimeService);

    await Effect.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ServerRuntime;
        yield* runtime.start;
        yield* runtime.stop;
      }).pipe(Effect.provide(layer)),
    );

    expect(calls).toEqual(["start", "stop"]);
  });

  it("pairs scoped runtime acquisition with release", async () => {
    const calls: string[] = [];
    const runtime: ServerRuntimeService = {
      start: Effect.sync(() => calls.push("start")),
      stop: Effect.sync(() => calls.push("stop")),
    };

    await Effect.runPromise(Effect.scoped(scopedServerRuntime(runtime)));

    expect(calls).toEqual(["start", "stop"]);
  });
});
