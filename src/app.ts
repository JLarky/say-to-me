import { Elysia, t } from 'elysia'
import { health } from './modules/health'
import { createRelay } from './modules/relay'
import { openapiPlugin } from './plugins/openapi'

type AppOptions = ConstructorParameters<typeof Elysia>[0]

export function createApp(
  options: AppOptions = {},
  relayFetch: typeof fetch = globalThis.fetch
) {
  return new Elysia(options)
    .use(openapiPlugin)
    .use(health)
    .use(createRelay(relayFetch))
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
            'Pointers to health, the Paseo relay probe, and OpenAPI documentation.'
        }
      }
    )
}

export type App = ReturnType<typeof createApp>
