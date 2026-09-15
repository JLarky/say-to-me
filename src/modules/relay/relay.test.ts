import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { Schema } from 'effect'
import { createApp } from '../../app.ts'
import { decodeResponseJson } from '../../decode-response-json.ts'

const previousRelayUrl = process.env.RELAY_URL

const RelayPointers = Schema.Struct({
  health: Schema.String,
  ws: Schema.String,
  tls: Schema.Literal(false)
})

const RelayOk = Schema.Struct({
  status: Schema.Literal('ok'),
  relay: RelayPointers,
  payload: Schema.String,
  echoed: Schema.String,
  serverId: Schema.String
})

const RelayError = Schema.Struct({
  status: Schema.Literal('error'),
  error: Schema.String,
  relay: RelayPointers
})

afterEach(() => {
  if (previousRelayUrl === undefined) {
    delete process.env.RELAY_URL
  } else {
    process.env.RELAY_URL = previousRelayUrl
  }
})

describe('relay', () => {
  it('echoes a random string through the configured relay', async () => {
    process.env.RELAY_URL = 'http://203.0.113.1:4000'

    const app = createApp({}, async (baseWs) => {
      assert.equal(baseWs, 'ws://203.0.113.1:4000/ws')

      return {
        serverId: 'say-to-me2-test'
      }
    })

    const response = await app.handle(new Request('http://localhost/relay'))
    const body = await decodeResponseJson(response, RelayOk)

    assert.equal(response.status, 200)
    assert.equal(body.echoed, body.payload)
    assert.equal(body.relay.ws, 'ws://203.0.113.1:4000/ws')
    assert.equal(body.relay.health, 'http://203.0.113.1:4000/health')
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
    assert.deepEqual(await decodeResponseJson(response, RelayError), {
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
