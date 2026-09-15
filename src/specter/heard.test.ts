import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createHeardSpecterApp } from './heard.ts'

describe('heard Specter slice', () => {
  it('records a receipt through the command and returns it from the query', async () => {
    const app = createHeardSpecterApp()

    await app.recordHeard({ sessionId: 'voice-alpha', messageId: '42' })
    const listed = await app.heardQuery({ sessionId: 'voice-alpha' })

    assert.equal(listed.receipts.length, 1)
    assert.equal(listed.receipts[0]?.messageId, '42')
    assert.match(listed.receipts[0]?.heardAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
  })

  it('does not duplicate an already-heard message id', async () => {
    const app = createHeardSpecterApp()

    await app.recordHeard({ sessionId: 'voice-alpha', messageId: '42' })
    await app.recordHeard({ sessionId: 'voice-alpha', messageId: '42' })

    const listed = await app.heardQuery({ sessionId: 'voice-alpha' })
    assert.equal(listed.receipts.length, 1)
    assert.equal(listed.receipts[0]?.messageId, '42')
  })

  it('isolates receipts by session', async () => {
    const app = createHeardSpecterApp()

    await app.recordHeard({ sessionId: 'voice-alpha', messageId: '1' })
    await app.recordHeard({ sessionId: 'voice-beta', messageId: '2' })

    const alpha = await app.heardQuery({ sessionId: 'voice-alpha' })
    const beta = await app.heardQuery({ sessionId: 'voice-beta' })

    assert.equal(alpha.receipts.length, 1)
    assert.equal(alpha.receipts[0]?.messageId, '1')
    assert.equal(beta.receipts.length, 1)
    assert.equal(beta.receipts[0]?.messageId, '2')
  })
})
