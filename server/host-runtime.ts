import { Effect, Layer } from "effect";
import { ensureSseDiagnosticsLogging } from "./sse/diagnostics.ts";
import { OpenCodeDeliveryRuntimeLive } from "./opencode/durable-delivery.ts";
import { ServerRuntime, ServerRuntimeLive } from "./runtime.ts";

const HostRuntimeLive = ServerRuntimeLive.pipe(Layer.provide(OpenCodeDeliveryRuntimeLive));

let started = false;
let startCalls = 0;
let resumeCalls = 0;

const startHostRuntimeEffect = Effect.gen(function* () {
  const runtime = yield* ServerRuntime;
  yield* runtime.start;
  ensureSseDiagnosticsLogging();
}).pipe(Effect.provide(HostRuntimeLive));

const stopHostRuntimeEffect = Effect.gen(function* () {
  const runtime = yield* ServerRuntime;
  yield* runtime.stop;
}).pipe(Effect.provide(HostRuntimeLive));

export function ensureHostRuntimeStarted(): void {
  ensureHostRuntimeStartedWithOptions();
}

export function ensureHostRuntimeStartedWithOptions({ resume = false } = {}): void {
  if (started && !resume) return;
  if (started && resume) {
    resumeCalls += 1;
    Effect.runSync(startHostRuntimeEffect);
    return;
  }
  startCalls += 1;
  Effect.runSync(startHostRuntimeEffect);
  started = true;
}

export function hostRuntimeStartedCountForTest(): number {
  return startCalls;
}

export function hostRuntimeResumeCountForTest(): number {
  return resumeCalls;
}

export async function stopHostRuntime(): Promise<void> {
  if (!started) return;
  await Effect.runPromise(stopHostRuntimeEffect);
  started = false;
}
