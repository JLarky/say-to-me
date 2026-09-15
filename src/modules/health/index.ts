import { Elysia } from 'elysia'
import { HealthModel } from './model.ts'

export const health = new Elysia({ name: 'health' }).get(
  '/health',
  (): HealthModel['response'] => ({ status: 'ok' }),
  {
    response: {
      200: HealthModel.response,
    },
    detail: {
      tags: ['ops'],
      summary: 'Health check',
      description: 'Returns ok when this process is serving requests.',
    },
  },
)
