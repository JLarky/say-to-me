import { Context, Layer } from "effect";

export function fakeServiceLayer<Identifier, Service>(
  tag: Context.Tag<Identifier, Service>,
  buildService: (calls: string[]) => Service,
) {
  const calls: string[] = [];
  return {
    calls,
    layer: Layer.succeed(tag, buildService(calls)),
  };
}
