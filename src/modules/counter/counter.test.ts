import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApp } from '../../app.ts'

const app = createApp()

describe('counter', () => {
  it('serves an HTML page that loads lift-html/solid', async () => {
    const response = await app.handle(new Request('http://localhost/counter'))

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /text\/html/)

    const html = await response.text()

    assert.match(html, /<say-to-me2-counter>/)
    assert.match(html, /liftSolid/)
    assert.match(html, /@lift-html\/solid/)
    assert.match(html, /createSignal/)
  })
})
