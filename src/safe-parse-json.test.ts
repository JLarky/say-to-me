import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import { safeParseJSON } from './safe-parse-json'

const HealthBody = Schema.Struct({
  status: Schema.Literal('ok')
})

function jsonResponse(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'application/json' }
  })
}

describe('safeParseJSON', () => {
  it('returns decoded json when it matches the schema', async () => {
    const response = jsonResponse(JSON.stringify({ status: 'ok' }))

    assert.deepEqual(await safeParseJSON(response, HealthBody), {
      status: 'ok'
    })
  })

  it('rejects json that does not match the schema', async () => {
    const response = jsonResponse(JSON.stringify({ status: 'nope' }))

    await assert.rejects(() => safeParseJSON(response, HealthBody))
  })
})
