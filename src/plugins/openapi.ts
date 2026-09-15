import { openapi } from '@elysiajs/openapi'

export const openapiPlugin = openapi({
  documentation: {
    info: {
      title: 'say-to-me2',
      version: '0.1.0',
      description:
        'Local Elysia service. First slice: health plus OpenAPI docs.'
    },
    tags: [
      {
        name: 'ops',
        description: 'Process liveness and operator endpoints'
      }
    ]
  }
})
