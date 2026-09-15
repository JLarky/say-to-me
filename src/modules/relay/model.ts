import { t, type UnwrapSchema } from 'elysia'

const relayPointers = t.Object({
  health: t.String(),
  ws: t.String(),
  tls: t.Boolean()
})

export const RelayModel = {
  ok: t.Object({
    status: t.Literal('ok'),
    relay: relayPointers,
    payload: t.String(),
    echoed: t.String(),
    serverId: t.String()
  }),
  error: t.Object({
    status: t.Literal('error'),
    error: t.String(),
    relay: relayPointers
  })
} as const

export type RelayModel = {
  [K in keyof typeof RelayModel]: UnwrapSchema<(typeof RelayModel)[K]>
}
