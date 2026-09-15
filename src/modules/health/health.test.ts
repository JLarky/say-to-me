import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import { createApp } from '../../app'
import { safeParseJSON } from '../../safe-parse-json'

const app = createApp()

const HealthResponse = Schema.Struct({
  status: Schema.Literal('ok')
})

describe('health', () => {
  it('returns ok', async () => {
    const response = await app.handle(new Request('http://localhost/health'))

    assert.equal(response.status, 200)
    assert.deepEqual(await safeParseJSON(response, HealthResponse), {
      status: 'ok'
    })
  })
})
