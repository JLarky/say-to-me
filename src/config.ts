import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

const defaultPort = 43141

const relayUrl = z
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol

    return protocol === 'http:' || protocol === 'https:'
  }, 'RELAY_URL must be an http or https URL')

export function loadEnv(runtimeEnv: NodeJS.ProcessEnv = process.env) {
  return createEnv({
    server: {
      HOST: z.string().min(1).default('0.0.0.0'),
      PORT: z.coerce.number().int().positive().default(defaultPort),
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
