import { Elysia } from 'elysia'
import { loadEnv, relayPointers } from '../../config.ts'
import { RelayModel } from './model.ts'
import { randomPayload, relayRoundTrip, type RelayRoundTripResult } from './round-trip.ts'

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }

  return 'relay round-trip failed'
}

export function createRelay(
  roundTrip?: (baseWs: string, payload: string) => Promise<RelayRoundTripResult>,
) {
  const run = roundTrip ?? relayRoundTrip

  return new Elysia({ name: 'relay' }).get(
    '/relay',
    async ({ set }): Promise<RelayModel['ok'] | RelayModel['error']> => {
      const env = loadEnv()
      const pointers = relayPointers(env.RELAY_URL)
      const payload = randomPayload()

      try {
        const result = await run(pointers.ws, payload)

        return {
          status: 'ok',
          relay: pointers,
          payload,
          echoed: payload,
          serverId: result.serverId,
        }
      } catch (cause) {
        set.status = 502

        return {
          status: 'error',
          error: errorMessage(cause),
          relay: pointers,
        }
      }
    },
    {
      response: {
        200: RelayModel.ok,
        502: RelayModel.error,
      },
      detail: {
        tags: ['relay'],
        summary: 'Paseo relay round-trip',
        description:
          'Opens a v2 server/client WebSocket pair, sends e2ee_hello with a 32-byte X25519 key, then echoes a random string through the relay within 3s. RELAY_URL is required at process start.',
      },
    },
  )
}

export const relay = createRelay()
