import { Schema } from 'effect'

export const PairingCodePayload = Schema.Struct({
  v: Schema.Literal(1),
  clientId: Schema.NonEmptyString,
  serverId: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
  relay: Schema.NonEmptyString,
})

export type PairingCodePayload = typeof PairingCodePayload.Type

const PairingCode = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(PairingCodePayload)),
)

export function encodePairingCode(payload: PairingCodePayload): string {
  return Schema.encodeSync(PairingCode)(payload)
}

export function decodePairingCode(code: string): PairingCodePayload {
  if (code.trim().length === 0) {
    throw new Error('pairing code is empty')
  }

  return Schema.decodeUnknownSync(PairingCode)(code)
}
