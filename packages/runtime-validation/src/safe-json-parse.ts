import { type as arktype } from "arktype";

// oxlint-disable anti-slop/no-unknown-parameters -- ArkType schemas must accept untrusted JSON before validation.
export type JsonSchema<T> = ((data: unknown) => T | arktype.errors) & {
  assert: (data: unknown) => T;
};
// oxlint-enable anti-slop/no-unknown-parameters

/** A value which JSON.parse can produce. */
export type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type SafeJsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error | arktype.errors };

/** Only place in the app allowed to call JSON.parse directly (see vite.config.ts lint rules). */
function parseJsonText(raw: string): JsonValue {
  return JSON.parse(raw);
}

/** Parse JSON text and validate with an ArkType schema; returns null on syntax or schema failure. */
export function safeJsonParse<T>(schema: JsonSchema<T>, raw: string): T | null {
  const result = safeJsonParseWithError(schema, raw);
  return result.ok ? result.value : null;
}

/** Parse JSON text and validate with an ArkType schema, retaining the failure cause. */
export function safeJsonParseWithError<T>(
  schema: JsonSchema<T>,
  raw: string,
): SafeJsonParseResult<T> {
  let parsed: unknown;
  try {
    parsed = parseJsonText(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  const result = schema(parsed);
  if (result instanceof arktype.errors) return { ok: false, error: result };
  return { ok: true, value: result };
}

/** Parse JSON text and validate with an ArkType schema; throws on syntax or schema failure. */
export function parseJson<T>(schema: JsonSchema<T>, raw: string): T {
  return schema.assert(parseJsonText(raw));
}

/** Parse a fetch Response body as JSON and validate with an ArkType schema; throws on failure. */
export async function safeResponseJson<T>(response: Response, schema: JsonSchema<T>): Promise<T> {
  const raw: unknown = await response.json();
  return schema.assert(raw);
}

export const UnknownJson = arktype("unknown");
export const JsonStringArray = arktype("string[]");
export const JsonUnknownArray = arktype("unknown[]");
