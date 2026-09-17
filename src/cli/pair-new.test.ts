import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { decodePairingCode } from '../modules/relay/pairing.ts'
import { closeV2Forwarder, listenV2Forwarder } from '../modules/relay/v2-forwarder.ts'
import { createPairedClientsSpecterApp } from '../specter/paired-clients.ts'
import { runCli } from './main.ts'
import { pairNew } from './pair-new.ts'
import { runCapturedCommand } from './run-command.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

const binPath = join(repoRoot, 'bin/say-to-me2')

const issued = {
  clientId: 'clt-alpha',
  serverId: 'say-to-me2-alpha',
  code: 'pairing-code-alpha',
  relay: {
    health: 'http://203.0.113.1:4000/health',
    ws: 'ws://203.0.113.1:4000/ws',
    tls: false,
    url: 'http://203.0.113.1:4000',
  },
}

const relayEnv = {
  RELAY_URL: 'http://203.0.113.1:4000',
}

describe('pair new', () => {
  it('fails when RELAY_URL is missing', async () => {
    const outcome = await pairNew({
      env: {},
      specter: createPairedClientsSpecterApp(),
      issuePairing: async () => {
        throw new Error('relay should not be contacted')
      },
    })

    assert.equal(outcome.ok, false)

    if (!outcome.ok) {
      assert.match(outcome.message, /RELAY_URL|Invalid environment|required/i)
    }
  })

  it('fails when the relay cannot issue a pairing code', async () => {
    const outcome = await pairNew({
      env: relayEnv,
      specter: createPairedClientsSpecterApp(),
      issuePairing: async () => {
        throw new Error('relay pairing timed out')
      },
    })

    assert.equal(outcome.ok, false)

    if (!outcome.ok) {
      assert.match(outcome.message, /relay pairing timed out/)
    }
  })

  it('fails when the issued pairing code is empty', async () => {
    const outcome = await pairNew({
      env: relayEnv,
      specter: createPairedClientsSpecterApp(),
      issuePairing: async () => ({
        ...issued,
        clientId: '',
        code: '',
      }),
    })

    assert.equal(outcome.ok, false)

    if (!outcome.ok) {
      assert.match(outcome.message, /pairing code is empty/)
    }
  })

  it('records the issued client id after a successful pair', async () => {
    const specter = createPairedClientsSpecterApp()
    let contacted: string | undefined

    const outcome = await pairNew({
      env: relayEnv,
      specter,
      issuePairing: async (relayUrl) => {
        contacted = relayUrl

        return issued
      },
    })

    assert.equal(contacted, relayEnv.RELAY_URL)
    assert.equal(outcome.ok, true)

    if (outcome.ok) {
      assert.equal(outcome.clientId, 'clt-alpha')
      assert.equal(outcome.code, 'pairing-code-alpha')
      assert.equal(outcome.relayUrl, relayEnv.RELAY_URL)
    }

    const listed = await specter.pairedClientsQuery({})
    assert.equal(listed.clients.length, 1)
    assert.equal(listed.clients[0]?.clientId, 'clt-alpha')
  })
})

describe('runCli pair new', () => {
  it('prints the pairing code and recorded client on success', async () => {
    let stdout = ''
    const specter = createPairedClientsSpecterApp()

    const code = await runCli(
      ['pair', 'new'],
      {
        writeStdout(text) {
          stdout += text
        },
        writeStderr() {},
      },
      {
        env: relayEnv,
        specter,
        issuePairing: async () => issued,
      },
    )

    assert.equal(code, 0)
    assert.match(stdout, /paired clt-alpha/)
    assert.match(stdout, /code pairing-code-alpha/)
    assert.match(stdout, /relay http:\/\/203\.0\.113\.1:4000/)
  })
})

describe('bin/say-to-me2 pair new', () => {
  it('issues a pairing code against the relay and records the client', async () => {
    const forwarder = await listenV2Forwarder('pipe')

    try {
      const result = await runCapturedCommand({
        file: binPath,
        args: ['pair', 'new'],
        env: {
          ...process.env,
          RELAY_URL: forwarder.origin,
        },
        timeoutMs: 10_000,
      })

      assert.equal(result.exitCode, 0, result.stderr)
      assert.match(result.stdout, /^paired clt-[0-9a-f]+\n/)
      assert.match(result.stdout, /^code /m)
      assert.match(result.stdout, new RegExp(`relay ${forwarder.origin}`))

      const codeLine = result.stdout.split('\n').find((line) => line.startsWith('code '))
      assert.ok(codeLine)
      const decoded = decodePairingCode(codeLine.slice('code '.length))
      assert.equal(decoded.relay, forwarder.origin)
      assert.match(decoded.clientId, /^clt-[0-9a-f]+$/)
    } finally {
      await closeV2Forwarder(forwarder.server)
    }
  })

  it('exits 1 when RELAY_URL is missing', async () => {
    const env = { ...process.env }
    delete env.RELAY_URL

    const result = await runCapturedCommand({
      file: binPath,
      args: ['pair', 'new'],
      env,
      timeoutMs: 10_000,
    })

    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /RELAY_URL|Invalid environment|required/i)
  })

  it('exits 1 when the relay does not answer', async () => {
    const result = await runCapturedCommand({
      file: binPath,
      args: ['pair', 'new'],
      env: {
        ...process.env,
        RELAY_URL: 'http://127.0.0.1:1',
      },
      timeoutMs: 10_000,
    })

    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /./)
  })
})
