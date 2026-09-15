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
