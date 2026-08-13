import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpServer from "@effect/platform/HttpServer";
import { Layer } from "effect";

export type CapabilityHttpHandler = {
  handler: (request: Request) => Promise<Response>;
  dispose: () => void | PromiseLike<void>;
};

/**
 * Build a web handler for one Effect HttpApi (typically a single capability
 * group) with supplied handler + service layers. Avoids merged-api / DB / host.
 *
 * Accepts loosely typed layers because each capability's HttpApi identifier and
 * service requirements differ; callers still pass the concrete Api/handlers.
 */
export function createCapabilityHttpHandler(options: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- per-capability HttpApi ids differ
  api: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake service layers vary by tag
  handlers: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake service layers vary by tag
  services: any;
}): CapabilityHttpHandler {
  const webHandler = HttpApiBuilder.toWebHandler(
    Layer.mergeAll(
      HttpApiBuilder.api(options.api).pipe(
        Layer.provide(options.handlers),
        Layer.provide(options.services),
      ),
      HttpServer.layerContext,
    ) as never,
  );
  return {
    handler: (request) => webHandler.handler(request),
    dispose: () => webHandler.dispose(),
  };
}
