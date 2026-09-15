import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApp } from '../app'

const app = createApp()

describe('openapi', () => {
  it('serves a spec that documents /health', async () => {
    const response = await app.handle(
      new Request('http://localhost/openapi/json')
    )
    const spec = (await response.json()) as {
      paths?: Record<string, unknown>
    }

    assert.equal(response.status, 200)
    assert.ok(spec.paths?.['/health'])
  })
})
