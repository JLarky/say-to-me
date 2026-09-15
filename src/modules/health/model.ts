import { t, type UnwrapSchema } from 'elysia'

export const HealthModel = {
  response: t.Object({
    status: t.Literal('ok'),
  }),
} as const

export type HealthModel = {
  [K in keyof typeof HealthModel]: UnwrapSchema<(typeof HealthModel)[K]>
}
