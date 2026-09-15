import { Schema } from 'effect'

export type JsonBodySource = Pick<Response, 'json'>

export async function safeParseJSON<S extends Schema.ConstraintDecoder<unknown>>(
  response: JsonBodySource,
  schema: S
): Promise<S['Type']> {
  return Schema.decodeUnknownSync(schema)(await response.json())
}
