import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createPairedClientsSpecterApp } from './paired-clients.ts'

describe('paired-clients Specter slice', () => {
  it('records a pair through the command and returns it from the query', async () => {
    const app = createPairedClientsSpecterApp()

    await app.recordPair({ clientId: 'paseo-alpha' })
    const listed = await app.pairedClientsQuery({})

    assert.equal(listed.clients.length, 1)
    assert.equal(listed.clients[0]?.clientId, 'paseo-alpha')
    assert.match(listed.clients[0]?.pairedAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
  })

  it('does not duplicate an already-paired client id', async () => {
    const app = createPairedClientsSpecterApp()

    await app.recordPair({ clientId: 'paseo-alpha' })
    await app.recordPair({ clientId: 'paseo-alpha' })

    const listed = await app.pairedClientsQuery({})
    assert.equal(listed.clients.length, 1)
    assert.equal(listed.clients[0]?.clientId, 'paseo-alpha')
  })

  it('lists distinct paired clients in the order they were recorded', async () => {
    const app = createPairedClientsSpecterApp()

    await app.recordPair({ clientId: 'paseo-alpha' })
    await app.recordPair({ clientId: 'paseo-beta' })

    const listed = await app.pairedClientsQuery({})

    assert.equal(listed.clients.length, 2)
    assert.equal(listed.clients[0]?.clientId, 'paseo-alpha')
    assert.equal(listed.clients[1]?.clientId, 'paseo-beta')
  })
})
