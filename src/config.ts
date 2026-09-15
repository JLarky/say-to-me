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

const defaultRelayPort = 4000

export type RelayConfig = {
  ip: string
  port: number
  tls: false
}

export function getRelayConfig(): RelayConfig {
  const parsedRelayPort = Number(process.env.RELAY_PORT ?? defaultRelayPort)

  if (!Number.isInteger(parsedRelayPort) || parsedRelayPort <= 0) {
    throw new Error(
      `RELAY_PORT must be a positive integer, got ${process.env.RELAY_PORT}`
    )
  }

  return {
    ip: process.env.RELAY_IP?.trim() ?? '',
    port: parsedRelayPort,
    tls: false
  }
}

export function relayUrls(relay = getRelayConfig()) {
  const host = `${relay.ip}:${relay.port}`

  return {
    health: `http://${host}/health`,
    ws: `ws://${host}/ws`
  }
}

export const config = {
  port: parsedPort,
  hostname: process.env.HOST ?? '0.0.0.0'
} as const
