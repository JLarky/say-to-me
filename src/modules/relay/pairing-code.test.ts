import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import { decodePairingCode, encodePairingCode, type PairingCodePayload } from './pairing-code.ts'

const samplePayload: PairingCodePayload = {
  v: 1,
  clientId: 'clt-alpha',
  serverId: 'say-to-me2-alpha',
  key: 'EGzlC/NkFzOjqaGEtEANUzEHe38iNRj9hfyuUbTeOy4=',
  relay: 'http://203.0.113.1:4000',
}

describe('pairing code', () => {
  it('rejects an empty code', () => {
    assert.throws(() => decodePairingCode(''), /pairing code is empty/)
    assert.throws(() => decodePairingCode('   '), /pairing code is empty/)
  })

  it('rejects text that is not a pairing code', () => {
    assert.throws(() => decodePairingCode('not-a-code'))
  })

  it('rejects base64url that is not a v1 pairing payload', () => {
    const emptyObject = Schema.encodeSync(Schema.StringFromBase64Url)('{}')

    const WrongVersion = Schema.Struct({
      v: Schema.Literal(2),
      clientId: Schema.NonEmptyString,
      serverId: Schema.NonEmptyString,
      key: Schema.NonEmptyString,
      relay: Schema.NonEmptyString,
    })

    const wrongVersion = Schema.encodeSync(
      Schema.StringFromBase64Url.pipe(Schema.decodeTo(Schema.fromJsonString(WrongVersion))),
    )({
      v: 2,
      clientId: samplePayload.clientId,
      serverId: samplePayload.serverId,
      key: samplePayload.key,
      relay: samplePayload.relay,
    })

    assert.throws(() => decodePairingCode(emptyObject))
    assert.throws(() => decodePairingCode(wrongVersion))
  })

  it('round-trips a pairing code payload', () => {
    const encoded = encodePairingCode(samplePayload)
    const decoded = decodePairingCode(encoded)

    assert.match(encoded, /^[A-Za-z0-9_-]+$/)
    assert.deepEqual(decoded, samplePayload)
  })
})
