import { openapi } from '@elysiajs/openapi'

export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: 'say-to-me2',
      version: '0.1.0',
      description:
        'Local Elysia service. Health, OpenAPI docs, and a Paseo relay probe over plain HTTP/WebSocket.'
    },
    tags: [
      {
        name: 'ops',
        description: 'Process liveness and operator endpoints'
      },
      {
        name: 'relay',
        description: 'Paseo relay (no TLS) health probe and connection URLs'
      }
    ]
  }
})
