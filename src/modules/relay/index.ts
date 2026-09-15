import { Value } from '@sinclair/typebox/value'
import { Elysia } from 'elysia'
import { getRelayConfig, relayUrls } from '../../config'
import { RelayModel, UpstreamHealth } from './model'

const probeTimeoutMs = 3_000

function isUpstreamOk(value: unknown): value is { status: 'ok' } {
  return Value.Check(UpstreamHealth, value)
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }

  return 'relay probe failed'
}

export function createRelay(relayFetch: typeof fetch = globalThis.fetch) {
  return new Elysia({ name: 'relay' }).get(
    '/relay',
    async ({ set }): Promise<
      RelayModel['ok'] | RelayModel['error'] | RelayModel['unconfigured']
    > => {
      const relay = getRelayConfig()

      if (!relay.ip) {
        set.status = 503

        return {
          status: 'error',
          error: 'RELAY_IP is not set'
        }
      }

      const urls = relayUrls(relay)

      const pointers = {
        health: urls.health,
        ws: urls.ws,
        tls: false as const
      }

      try {
        const response = await relayFetch(urls.health, {
          signal: AbortSignal.timeout(probeTimeoutMs),
          headers: { accept: 'application/json' }
        })

        const upstream = await response.json()

        if (response.ok && isUpstreamOk(upstream)) {
          return {
            status: 'ok',
            relay: pointers,
            upstream: { status: 'ok' }
          }
        }

        set.status = 502

        return {
          status: 'error',
          error: `relay health returned HTTP ${response.status}`,
          relay: pointers
        }
      } catch (cause) {
        set.status = 502

        return {
          status: 'error',
          error: errorMessage(cause),
          relay: pointers
        }
      }
    },
    {
      response: {
        200: RelayModel.ok,
        502: RelayModel.error,
        503: RelayModel.unconfigured
      },
      detail: {
        tags: ['relay'],
        summary: 'Paseo relay probe',
        description:
          'Probes the configured Paseo relay over plain HTTP (no TLS) and returns health plus WebSocket URLs.'
      }
    }
  )
}

export const relay = createRelay()
