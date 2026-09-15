import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApp } from '../app'

const app = createApp()

describe('openapi', () => {
  it('serves a spec that documents /health', async () => {
    const response = await app.handle(
      new Request('http://localhost/openapi/json')
    )

    const spec = await response.json()

    assert.equal(response.status, 200)
    assert.ok(hasDocumentedHealthPath(spec))
  })
})

type OpenApiDocument = {
  paths?: {
    '/health'?: OpenApiPathItem
  }
}

type OpenApiPathItem = {
  get?: {
    summary?: string
  }
}

function hasDocumentedHealthPath(
  spec: unknown
): spec is OpenApiDocument & { paths: { '/health': OpenApiPathItem } } {
  if (spec === null) {
    return false
  }

  const candidate = Object(spec)

  if (!('paths' in candidate)) {
    return false
  }

  const paths = candidate.paths

  if (paths === null || paths === undefined) {
    return false
  }

  return '/health' in Object(paths)
}
