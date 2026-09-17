import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApp } from '../../app.ts'

const app = createApp()

describe('counter', () => {
  it('serves an HTML page that loads the Solid JSX bundle', async () => {
    const response = await app.handle(new Request('http://localhost/counter'))

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /text\/html/)

    const html = await response.text()

    assert.match(html, /id="app"/)
    assert.match(html, /src="\/counter\.js"/)
    assert.doesNotMatch(html, /liftSolid/)
  })

  it('serves the compiled counter script', async () => {
    const response = await app.handle(new Request('http://localhost/counter.js'))

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /javascript/)

    const script = await response.text()

    assert.match(script, /say-to-me2-counter/)
    assert.match(script, /_\$DX_DELEGATE/)
  })
})
