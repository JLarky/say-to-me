import { Schema } from 'effect'

export type JsonBodySource = Pick<Response, 'json'>

export function decodeJsonText(text: string, schema: typeof Schema.Json) {
  return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(text)
}

export async function decodeResponseJson<S extends Schema.ConstraintDecoder<unknown>>(
  response: JsonBodySource,
  schema: S
): Promise<S['Type']> {
  return Schema.decodeUnknownSync(schema)(await response.json())
}
