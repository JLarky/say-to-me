import { createEnv } from '@t3-oss/env-core'
import { Effect, Schema } from 'effect'

const defaultPort = 43141

const host = Schema.toStandardSchemaV1(
  Schema.NonEmptyString.pipe(Schema.withDecodingDefault(Effect.succeed('0.0.0.0')))
)

const port = Schema.toStandardSchemaV1(
  Schema.FiniteFromString.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
    Schema.withDecodingDefault(Effect.succeed(String(defaultPort)))
  )
)

const relayUrl = Schema.toStandardSchemaV1(
  Schema.String.check(
    Schema.makeFilter((value) => {
      try {
        const protocol = new URL(value).protocol

        if (protocol === 'http:' || protocol === 'https:') {
          return undefined
        }
      } catch {
        return 'RELAY_URL must be an http or https URL'
      }

      return 'RELAY_URL must be an http or https URL'
    })
  )
)

export function loadEnv(runtimeEnv: NodeJS.ProcessEnv = process.env) {
  return createEnv({
    server: {
      HOST: host,
      PORT: port,
      RELAY_URL: relayUrl
    },
    runtimeEnv,
    emptyStringAsUndefined: true
  })
}

export type RelayPointers = {
  health: string
  ws: string
  tls: boolean
}

export function relayPointers(relayUrl: string): RelayPointers {
  const parsed = new URL(relayUrl)
  const tls = parsed.protocol === 'https:'

  return {
    health: `${parsed.origin}/health`,
    ws: `${tls ? 'wss:' : 'ws:'}//${parsed.host}/ws`,
    tls
  }
}
