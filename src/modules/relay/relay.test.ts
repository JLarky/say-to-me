import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { Value } from '@sinclair/typebox/value'
import { t } from 'elysia'
import { createApp } from '../../app'

const previousRelayUrl = process.env.RELAY_URL

afterEach(() => {
  if (previousRelayUrl === undefined) {
    delete process.env.RELAY_URL
  } else {
    process.env.RELAY_URL = previousRelayUrl
  }
})

describe('relay', () => {
  it('probes a WebSocket round-trip through the configured relay', async () => {
    process.env.RELAY_URL = 'http://203.0.113.1:4000'

    const app = createApp({}, async (baseWs, payload) => {
      assert.equal(baseWs, 'ws://203.0.113.1:4000/ws')

      return {
        serverId: 'say-to-me2-test',
        payload,
        echoed: payload
      }
    })

    const response = await app.handle(new Request('http://localhost/relay'))
    const body: unknown = await response.json()

    assert.equal(response.status, 200)
    assert.ok(isOkBody(body))
    assert.equal(body.echoed, body.payload)
    assert.equal(body.relay.ws, 'ws://203.0.113.1:4000/ws')
    assert.equal(body.relay.tls, false)
    assert.equal(body.serverId, 'say-to-me2-test')
  })

  it('returns 502 when the round-trip fails', async () => {
    process.env.RELAY_URL = 'http://203.0.113.1:4000'

    const app = createApp({}, async () => {
      throw new TypeError('websocket failed')
    })

    const response = await app.handle(new Request('http://localhost/relay'))

    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), {
      status: 'error',
      error: 'websocket failed',
      relay: {
        health: 'http://203.0.113.1:4000/health',
        ws: 'ws://203.0.113.1:4000/ws',
        tls: false
      }
    })
  })
})

function isOkBody(value: unknown): value is {
  status: 'ok'
  echoed: string
  payload: string
  serverId: string
  relay: { ws: string; tls: boolean }
} {
  return Value.Check(
    t.Object({
      status: t.Literal('ok'),
      echoed: t.String(),
      payload: t.String(),
      serverId: t.String(),
      relay: t.Object({
        health: t.String(),
        ws: t.String(),
        tls: t.Boolean()
      })
    }),
    value
  )
}
