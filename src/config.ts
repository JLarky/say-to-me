import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadDotEnv(fileName = '.env') {
  const filePath = resolve(process.cwd(), fileName)

  if (!existsSync(filePath)) {
    return
  }

  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const eq = line.indexOf('=')

    if (eq <= 0) {
      continue
    }

    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadDotEnv()

const defaultPort = 43141

const parsedPort = Number(process.env.PORT ?? defaultPort)

if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
  throw new Error(`PORT must be a positive integer, got ${process.env.PORT}`)
}

export function getRelayUrl() {
  return process.env.RELAY_URL?.trim() ?? ''
}

export type RelayPointers = {
  health: string
  ws: string
  tls: false
}

export type RelayParseResult =
  | { ok: true; pointers: RelayPointers }
  | { ok: false; error: string }

export function parseRelayUrl(relayUrl: string): RelayParseResult {
  let parsed: URL

  try {
    parsed = new URL(relayUrl)
  } catch {
    return { ok: false, error: 'RELAY_URL is not a valid URL' }
  }

  if (parsed.protocol !== 'http:') {
    return { ok: false, error: 'RELAY_URL must be an http URL (no TLS)' }
  }

  return {
    ok: true,
    pointers: {
      health: `${parsed.origin}/health`,
      ws: `ws://${parsed.host}/ws`,
      tls: false
    }
  }
}

export const config = {
  port: parsedPort,
  hostname: process.env.HOST ?? '0.0.0.0'
} as const
