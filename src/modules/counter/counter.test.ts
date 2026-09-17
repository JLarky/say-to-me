import assert from 'node:assert/strict'
import { existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { createApp } from '../../app.ts'
import { readCounterDev } from './counter-dev.ts'

const app = createApp()

const distPath = join(dirname(fileURLToPath(import.meta.url)), 'dist/counter.js')

describe('readCounterDev', () => {
  it('returns proxy when COUNTER_VITE_ORIGIN is set', () => {
    assert.deepEqual(
      readCounterDev({
        COUNTER_VITE_ORIGIN: 'http://127.0.0.1:43192',
        COUNTER_HMR: 'middleware',
      }),
      { kind: 'proxy', origin: 'http://127.0.0.1:43192' },
    )
  })

  it('returns middleware when COUNTER_HMR is middleware', () => {
    assert.deepEqual(readCounterDev({ COUNTER_HMR: 'middleware' }), { kind: 'middleware' })
  })

  it('returns prod when HMR env is unset', () => {
    assert.deepEqual(readCounterDev({}), { kind: 'prod' })
  })
})

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

  it('imports the Vite HMR entry when COUNTER_HMR=middleware', async () => {
    const previous = process.env.COUNTER_HMR
    process.env.COUNTER_HMR = 'middleware'

    try {
      const response = await app.handle(new Request('http://localhost/counter'))
      const html = await response.text()

      assert.equal(response.status, 200)
      assert.match(html, /id="app"/)
      assert.match(html, /src="\/src\/modules\/counter\/counter-hmr\.ts"/)
      assert.doesNotMatch(html, /src="\/counter\.js"/)
    } finally {
      if (previous === undefined) {
        delete process.env.COUNTER_HMR
      } else {
        process.env.COUNTER_HMR = previous
      }
    }
  })

  it('serves the compiled counter script', async () => {
    const response = await app.handle(new Request('http://localhost/counter.js'))

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /javascript/)

    const script = await response.text()

    assert.match(script, /say-to-me2-counter/)
    assert.match(script, /_\$DX_DELEGATE/)
  })

  it('returns 503 when the compiled script is missing', async () => {
    assert.equal(existsSync(distPath), true)

    const hiddenPath = `${distPath}.hidden`
    renameSync(distPath, hiddenPath)

    try {
      const response = await app.handle(new Request('http://localhost/counter.js'))
      const body = await response.text()

      assert.equal(response.status, 503)
      assert.equal(body, 'counter script is not built')
    } finally {
      renameSync(hiddenPath, distPath)
    }
  })
})
