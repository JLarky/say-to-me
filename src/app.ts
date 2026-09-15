import { Elysia, t } from 'elysia'
import { health } from './modules/health/index.ts'
import { createRelay } from './modules/relay/index.ts'
import type { RelayRoundTripResult } from './modules/relay/round-trip.ts'
import { openapiPlugin } from './plugins/openapi.ts'

type AppOptions = ConstructorParameters<typeof Elysia>[0]

export function createApp(
  options: AppOptions = {},
  roundTrip?: (
    baseWs: string,
    payload: string
  ) => Promise<RelayRoundTripResult>
) {
  return new Elysia(options)
    .use(openapiPlugin)
    .use(health)
    .use(createRelay(roundTrip))
    .get(
      '/',
      () => ({
        name: 'say-to-me2' as const,
        health: '/health',
        relay: '/relay',
        openapi: '/openapi'
      }),
      {
        response: {
          200: t.Object({
            name: t.Literal('say-to-me2'),
            health: t.String(),
            relay: t.String(),
            openapi: t.String()
          })
        },
        detail: {
          tags: ['ops'],
          summary: 'Service index',
          description:
            'Pointers to health, the Paseo relay round-trip, and OpenAPI documentation.'
        }
      }
    )
}

export type App = ReturnType<typeof createApp>
