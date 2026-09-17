import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { relayRoundTrip } from './round-trip.ts'
import { closeV2Forwarder, listenV2Forwarder } from './v2-forwarder.ts'

function assertV2Pair(urls: string[], serverId: string) {
  assert.equal(urls.length, 3)

  const parsed = urls.map((value) => new URL(value, 'ws://127.0.0.1'))

  for (const url of parsed) {
    assert.equal(url.pathname, '/ws')
    assert.equal(url.searchParams.get('v'), '2')
    assert.equal(url.searchParams.get('serverId'), serverId)
  }

  const control = parsed.find(
    (url) =>
      url.searchParams.get('role') === 'server' && url.searchParams.get('connectionId') === null,
  )

  const client = parsed.find((url) => url.searchParams.get('role') === 'client')

  const serverData = parsed.find(
    (url) =>
      url.searchParams.get('role') === 'server' && url.searchParams.get('connectionId') !== null,
  )

  assert.ok(control)
  assert.ok(client)
  assert.ok(serverData)

  assert.equal(client.searchParams.get('connectionId'), serverData.searchParams.get('connectionId'))
}

function assertCanonicalX25519Key(key: string) {
  const raw = Buffer.from(key, 'base64')

  assert.equal(raw.byteLength, 32)
  assert.equal(key, raw.toString('base64'))
}

describe('relayRoundTrip', () => {
  it('round-trips through an in-process v2 forwarder', async () => {
    const forwarder = await listenV2Forwarder('pipe')

    try {
      const result = await relayRoundTrip(forwarder.baseWs, 'round-trip-payload')

      assert.match(result.serverId, /^say-to-me2-[0-9a-f]+$/)
      assertV2Pair(forwarder.urls, result.serverId)
      assertCanonicalX25519Key(forwarder.helloKey)
    } finally {
      await closeV2Forwarder(forwarder.server)
    }
  })

  it('throws when the peer echoes a different payload', async () => {
    const forwarder = await listenV2Forwarder('mismatch')

    try {
      await assert.rejects(
        () => relayRoundTrip(forwarder.baseWs, 'round-trip-payload'),
        /relay echoed a different payload/,
      )
    } finally {
      await closeV2Forwarder(forwarder.server)
    }
  })

  it('times out when a peer hangs', async () => {
    const forwarder = await listenV2Forwarder('hang')
    const started = Date.now()

    try {
      await assert.rejects(
        () => relayRoundTrip(forwarder.baseWs, 'round-trip-payload', 200),
        /relay round-trip timed out/,
      )
      assert.ok(Date.now() - started < 1000)
    } finally {
      await closeV2Forwarder(forwarder.server)
    }
  })
})
