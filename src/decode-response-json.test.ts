import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import { decodeResponseJson } from './decode-response-json.ts'

const HealthBody = Schema.Struct({
  status: Schema.Literal('ok')
})

function jsonResponse(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'application/json' }
  })
}

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
