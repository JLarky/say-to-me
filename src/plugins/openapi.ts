import { openapi } from '@elysiajs/openapi'

export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: 'say-to-me2',
      version: '0.1.0',
      description:
        'Local Elysia service. Health, OpenAPI docs, a relay WebSocket round-trip, and a lift-html/solid click counter in Solid JSX. RELAY_URL is required at boot.',
    },
    tags: [
      {
        name: 'ops',
        description: 'Process liveness and operator endpoints',
      },
      {
        name: 'relay',
        description:
          'Paseo relay v2 WebSocket round-trip of a random string after e2ee_hello. RELAY_URL is an http(s) origin, validated at process start.',
      },
    ],
  },
})
