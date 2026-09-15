import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import {
  decodeJsonText,
  decodeResponseJson
} from './decode-response-json.ts'

const HealthBody = Schema.Struct({
  status: Schema.Literal('ok')
})

function jsonResponse(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'application/json' }
  })
}

describe('decodeJsonText', () => {
  it('returns decoded json when it matches the schema', () => {
    assert.deepEqual(decodeJsonText(JSON.stringify({ status: 'ok' }), HealthBody), {
      status: 'ok'
    })
  })

  it('throws when the text is not json', () => {
    assert.throws(() => decodeJsonText('not-json', HealthBody))
  })

  it('throws when json does not match the schema', () => {
    assert.throws(() =>
      decodeJsonText(JSON.stringify({ status: 'nope' }), HealthBody)
    )
  })
})

describe('decodeResponseJson', () => {
  it('returns decoded json when it matches the schema', async () => {
    const response = jsonResponse(JSON.stringify({ status: 'ok' }))

    assert.deepEqual(await decodeResponseJson(response, HealthBody), {
      status: 'ok'
    })
  })

  it('rejects json that does not match the schema', async () => {
    const response = jsonResponse(JSON.stringify({ status: 'nope' }))

    await assert.rejects(() => decodeResponseJson(response, HealthBody))
  })
})
