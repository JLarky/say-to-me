import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import { createApp } from '../app'
import { safeParseJSON } from '../safe-parse-json'

const app = createApp()

const OpenApiHealthAndRelayDocument = Schema.Struct({
  paths: Schema.Struct({
    '/health': Schema.JsonObject,
    '/relay': Schema.JsonObject
  })
})

describe('openapi', () => {
  it('serves a spec that documents /health and /relay', async () => {
    const response = await app.handle(
      new Request('http://localhost/openapi/json')
    )

    assert.equal(response.status, 200)

    const spec = await safeParseJSON(response, OpenApiHealthAndRelayDocument)

    assert.ok(spec.paths['/health'])
    assert.ok(spec.paths['/relay'])
  })
})
