import { openapi } from '@elysiajs/openapi'

export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: 'say-to-me2',
      version: '0.1.0',
      description:
        'Local Elysia service. Health, OpenAPI docs, and a Paseo relay WebSocket round-trip. RELAY_URL is required at boot.'
    },
    tags: [
      {
        name: 'ops',
        description: 'Process liveness and operator endpoints'
      },
      {
        name: 'relay',
        description:
          'Paseo relay v2 WebSocket round-trip. RELAY_URL is an http(s) origin, validated at process start.'
      }
    ]
  }
})
