import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { Schema } from 'effect'
import { createApp } from '../../app'
import { decodeResponseJson } from '../../decode-response-json'

const previousRelayUrl = process.env.RELAY_URL

const RelayPointers = Schema.Struct({
  health: Schema.String,
  ws: Schema.String,
  tls: Schema.Literal(false)
})

const RelayUnconfigured = Schema.Struct({
  status: Schema.Literal('error'),
  error: Schema.String
})

const RelayOk = Schema.Struct({
  status: Schema.Literal('ok'),
  relay: RelayPointers,
  upstream: Schema.Struct({
    status: Schema.Literal('ok')
  })
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
  it('returns 503 when RELAY_URL is missing', async () => {
    delete process.env.RELAY_URL

    const app = createApp({}, async () => {
      throw new Error('should not fetch')
    })

    const response = await app.handle(new Request('http://localhost/relay'))

    assert.equal(response.status, 503)
    assert.deepEqual(await decodeResponseJson(response, RelayUnconfigured), {
      status: 'error',
      error: 'RELAY_URL is not set'
    })
  })

  it('probes the configured relay health URL', async () => {
    process.env.RELAY_URL = 'http://203.0.113.1:4000'

    const app = createApp({}, async (input) => {
      assert.equal(String(input), 'http://203.0.113.1:4000/health')

      return Response.json({ status: 'ok' })
    })

    const response = await app.handle(new Request('http://localhost/relay'))

    assert.equal(response.status, 200)
    assert.deepEqual(await decodeResponseJson(response, RelayOk), {
      status: 'ok',
      relay: {
        health: 'http://203.0.113.1:4000/health',
        ws: 'ws://203.0.113.1:4000/ws',
        tls: false
      },
      upstream: { status: 'ok' }
    })
  })

  it('returns 502 when the relay is unreachable', async () => {
    process.env.RELAY_URL = 'http://203.0.113.1:4000'

    const app = createApp({}, async () => {
      throw new TypeError('fetch failed')
    })

    const response = await app.handle(new Request('http://localhost/relay'))

    assert.equal(response.status, 502)
    assert.deepEqual(await decodeResponseJson(response, RelayError), {
      status: 'error',
      error: 'fetch failed',
      relay: {
        health: 'http://203.0.113.1:4000/health',
        ws: 'ws://203.0.113.1:4000/ws',
        tls: false
      }
    })
  })
})
