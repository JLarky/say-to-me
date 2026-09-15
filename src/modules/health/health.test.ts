import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApp } from '../../app'

const app = createApp()

describe('health', () => {
  it('returns ok', async () => {
    const response = await app.handle(new Request('http://localhost/health'))

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })
  })
})
