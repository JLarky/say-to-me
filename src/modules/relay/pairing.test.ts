import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decodePairingCode,
  encodePairingCode,
  issueRelayPairing,
  type PairingCodePayload,
} from './pairing.ts'
import { closeV2Forwarder, listenV2Forwarder } from './v2-forwarder.ts'

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

  it('round-trips a pairing code payload', () => {
    const decoded = decodePairingCode(encodePairingCode(samplePayload))

    assert.deepEqual(decoded, samplePayload)
  })
})

describe('issueRelayPairing', () => {
  it('issues a pairing code through the relay and echoes the client id', async () => {
    const forwarder = await listenV2Forwarder('pipe')

    try {
      const issued = await issueRelayPairing(forwarder.origin)
      const decoded = decodePairingCode(issued.code)

      assert.equal(issued.clientId, decoded.clientId)
      assert.equal(issued.serverId, decoded.serverId)
      assert.equal(decoded.v, 1)
      assert.equal(decoded.relay, forwarder.origin)
      assert.equal(issued.relay.url, forwarder.origin)
      assert.equal(issued.relay.ws, forwarder.baseWs)
      assert.match(issued.clientId, /^clt-[0-9a-f]+$/)
      assert.match(issued.serverId, /^say-to-me2-[0-9a-f]+$/)

      const client = issued.clientId

      const paired = forwarder.urls.filter((value) => {
        const url = new URL(value, 'ws://127.0.0.1')

        return url.searchParams.get('connectionId') === client
      })

      assert.equal(paired.length, 2)
    } finally {
      await closeV2Forwarder(forwarder.server)
    }
  })

  it('fails when the relay hangs', async () => {
    const forwarder = await listenV2Forwarder('hang')

    try {
      await assert.rejects(
        () => issueRelayPairing(forwarder.origin, 200),
        /relay pairing timed out/,
      )
    } finally {
      await closeV2Forwarder(forwarder.server)
    }
  })
})
