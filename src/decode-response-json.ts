import { Effect, Schema } from 'effect'

export type JsonBodySource = Pick<Response, 'json'>

export function decodeJsonText<S extends Schema.ConstraintDecoder<unknown>>(
  text: string,
  schema: S,
): S['Type'] {
  return Effect.runSync(Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text))
}

export async function decodeResponseJson<S extends Schema.ConstraintDecoder<unknown>>(
  response: JsonBodySource,
  schema: S,
): Promise<S['Type']> {
  return Schema.decodeUnknownSync(schema)(await response.json())
}
