import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadEnv } from './config.ts'

describe('env', () => {
  it('fails boot when RELAY_URL is missing', () => {
    assert.throws(() => loadEnv({ HOST: '0.0.0.0', PORT: '43141' }))
  })

  it('fails boot when RELAY_URL is empty', () => {
    assert.throws(() =>
      loadEnv({
        HOST: '0.0.0.0',
        PORT: '43141',
        RELAY_URL: '',
      }),
    )
  })

  it('fails boot when RELAY_URL is not http(s)', () => {
    assert.throws(() =>
      loadEnv({
        HOST: '0.0.0.0',
        PORT: '43141',
        RELAY_URL: 'ftp://203.0.113.1:4000',
      }),
    )
  })

  it('accepts an http RELAY_URL', () => {
    const env = loadEnv({
      HOST: '0.0.0.0',
      PORT: '43141',
      RELAY_URL: 'http://203.0.113.1:4000',
    })

    assert.equal(env.RELAY_URL, 'http://203.0.113.1:4000')
    assert.equal(env.PORT, 43141)
  })

  it('defaults HOST and PORT when they are omitted', () => {
    const env = loadEnv({
      RELAY_URL: 'http://203.0.113.1:4000',
    })

    assert.equal(env.HOST, '0.0.0.0')
    assert.equal(env.PORT, 43141)
  })
})
