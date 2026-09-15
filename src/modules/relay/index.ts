import { Value } from '@sinclair/typebox/value'
import { Elysia } from 'elysia'
import { loadEnv, relayPointers } from '../../config.ts'
import { RelayModel, UpstreamHealth } from './model.ts'

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
    async ({ set }): Promise<RelayModel['ok'] | RelayModel['error']> => {
      const env = loadEnv()
      const pointers = relayPointers(env.RELAY_URL)

      try {
        const response = await relayFetch(pointers.health, {
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
        502: RelayModel.error
      },
      detail: {
        tags: ['relay'],
        summary: 'Paseo relay probe',
        description:
          'Probes RELAY_URL over HTTP. RELAY_URL is required at process start.'
      }
    }
  )
}

export const relay = createRelay()
