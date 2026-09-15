import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createApp } from '../../app'

const previousRelayIp = process.env.RELAY_IP

const previousRelayPort = process.env.RELAY_PORT

afterEach(() => {
  if (previousRelayIp === undefined) {
    delete process.env.RELAY_IP
  } else {
    process.env.RELAY_IP = previousRelayIp
  }

  if (previousRelayPort === undefined) {
    delete process.env.RELAY_PORT
  } else {
    process.env.RELAY_PORT = previousRelayPort
  }
})

describe('relay', () => {
  it('returns 503 when RELAY_IP is missing', async () => {
    delete process.env.RELAY_IP

    const app = createApp({}, async () => {
      throw new Error('should not fetch')
    })

    const response = await app.handle(new Request('http://localhost/relay'))

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      status: 'error',
      error: 'RELAY_IP is not set'
    })
  })

  it('probes the configured relay health URL', async () => {
    process.env.RELAY_IP = '203.0.113.1'
    process.env.RELAY_PORT = '4000'

    const app = createApp({}, async (input) => {
      assert.equal(String(input), 'http://203.0.113.1:4000/health')

      return Response.json({ status: 'ok' })
    })

    const response = await app.handle(new Request('http://localhost/relay'))

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
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
    process.env.RELAY_IP = '203.0.113.1'

    const app = createApp({}, async () => {
      throw new TypeError('fetch failed')
    })

    const response = await app.handle(new Request('http://localhost/relay'))

    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), {
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
