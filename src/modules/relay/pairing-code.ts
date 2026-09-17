import { Option, Schema } from 'effect'
import { RelayUrl } from '../../config.ts'

const x25519PublicKeyBytes = Schema.Uint8ArrayFromBase64.check(Schema.isLengthBetween(32, 32))

const X25519PublicKeyB64 = Schema.String.check(
  Schema.makeFilter((value) =>
    Option.isSome(Schema.decodeUnknownOption(x25519PublicKeyBytes)(value))
      ? undefined
      : 'key must be standard Base64 of 32 bytes',
  ),
)

export const PairingCodePayload = Schema.Struct({
  v: Schema.Literal(1),
  clientId: Schema.NonEmptyString,
  serverId: Schema.NonEmptyString,
  key: X25519PublicKeyB64,
  relay: RelayUrl,
})

export type PairingCodePayload = typeof PairingCodePayload.Type

const PairingCode = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(PairingCodePayload)),
)

export function encodePairingCode(payload: PairingCodePayload): string {
  return Schema.encodeSync(PairingCode)(payload)
}

export function decodePairingCode(code: string): PairingCodePayload {
  const trimmed = code.trim()

  if (trimmed.length === 0) {
    throw new Error('pairing code is empty')
  }

  return Schema.decodeUnknownSync(PairingCode)(trimmed)
}
