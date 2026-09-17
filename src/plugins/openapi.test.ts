import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import { createApp } from '../app.ts'
import { decodeResponseJson } from '../decode-response-json.ts'

const app = createApp()

const OpenApiHealthRelayAndCounterDocument = Schema.Struct({
  paths: Schema.Struct({
    '/health': Schema.JsonObject,
    '/relay': Schema.JsonObject,
    '/counter': Schema.JsonObject,
  }),
})

describe('openapi', () => {
  it('serves a spec that documents /health, /relay, and /counter', async () => {
    const response = await app.handle(new Request('http://localhost/openapi/json'))

    assert.equal(response.status, 200)

    const spec = await decodeResponseJson(response, OpenApiHealthRelayAndCounterDocument)

    assert.ok(spec.paths['/health'])
    assert.ok(spec.paths['/relay'])
    assert.ok(spec.paths['/counter'])
  })
})
