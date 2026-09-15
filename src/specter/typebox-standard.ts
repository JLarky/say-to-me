import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { StandardSchemaV1 } from '@standard-schema/spec'

/** TypeBox → Standard Schema v1 so Specter can validate command/event payloads. */
export function typeboxStandardSchema<T extends TSchema>(
  schema: T,
): StandardSchemaV1<Static<T>, Static<T>> {
  return {
    '~standard': {
      version: 1,
      vendor: 'typebox',
      validate: (value) => {
        if (Value.Check(schema, value)) {
          return { value }
        }

        return {
          issues: Array.from(Value.Errors(schema, value), (error) => ({
            message: error.message,
          })),
        }
      },
    },
  }
}
