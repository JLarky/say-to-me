import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import { decodePairingCode, encodePairingCode, type PairingCodePayload } from './pairing-code.ts'

const LoosePayload = Schema.Struct({
  v: Schema.Literal(1),
  clientId: Schema.NonEmptyString,
  serverId: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
  relay: Schema.NonEmptyString,
})

const samplePayload: PairingCodePayload = {
  v: 1,
  clientId: 'clt-alpha',
  serverId: 'say-to-me2-alpha',
  key: 'EGzlC/NkFzOjqaGEtEANUzEHe38iNRj9hfyuUbTeOy4=',
  relay: 'http://203.0.113.1:4000',
}

function encodeLoose(payload: typeof LoosePayload.Type) {
  return Schema.encodeSync(
    Schema.StringFromBase64Url.pipe(Schema.decodeTo(Schema.fromJsonString(LoosePayload))),
  )(payload)
}

describe('pairing code', () => {
  it('rejects an empty code', () => {
    assert.throws(() => decodePairingCode(''), /pairing code is empty/)
    assert.throws(() => decodePairingCode('   '), /pairing code is empty/)
  })

  it('trims a pasted pairing code before decoding', () => {
    const encoded = encodePairingCode(samplePayload)

    assert.deepEqual(decodePairingCode(`  ${encoded}\n`), samplePayload)
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

  it('rejects a key that is not a 32-byte standard Base64 public key', () => {
    assert.throws(() => encodePairingCode({ ...samplePayload, key: 'hunter2' }))
    assert.throws(() => decodePairingCode(encodeLoose({ ...samplePayload, key: 'hunter2' })))
  })

  it('rejects a relay that is not an http(s) URL', () => {
    assert.throws(() => encodePairingCode({ ...samplePayload, relay: 'nope' }))
    assert.throws(() => decodePairingCode(encodeLoose({ ...samplePayload, relay: 'nope' })))
  })

  it('round-trips a pairing code payload', () => {
    const encoded = encodePairingCode(samplePayload)
    const decoded = decodePairingCode(encoded)

    assert.match(encoded, /^[A-Za-z0-9_-]+$/)
    assert.deepEqual(decoded, samplePayload)
  })

  it('round-trips a 32-byte standard Base64 key', () => {
    const payload = {
      ...samplePayload,
      key: Schema.encodeSync(Schema.Uint8ArrayFromBase64)(randomBytes(32)),
    }

    assert.deepEqual(decodePairingCode(encodePairingCode(payload)), payload)
  })
})
