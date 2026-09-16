import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cliUsage, parseArgv } from './argv.ts'

describe('parseArgv', () => {
  it('rejects an empty argv', () => {
    assert.deepEqual(parseArgv([]), { kind: 'error', message: cliUsage })
  })

  it('rejects unknown commands', () => {
    const parsed = parseArgv(['status'])

    assert.equal(parsed.kind, 'error')

    if (parsed.kind === 'error') {
      assert.match(parsed.message, /unknown command: status/)
    }
  })

  it('rejects pair new as an unknown command', () => {
    const parsed = parseArgv(['pair', 'new'])

    assert.equal(parsed.kind, 'error')

    if (parsed.kind === 'error') {
      assert.match(parsed.message, /unknown command: pair/)
    }
  })

  it('rejects extra arguments after help', () => {
    const parsed = parseArgv(['--help', 'extra'])

    assert.equal(parsed.kind, 'error')

    if (parsed.kind === 'error') {
      assert.match(parsed.message, /unexpected arguments: extra/)
    }
  })

  it('prints help for --help, -h, and help', () => {
    assert.deepEqual(parseArgv(['--help']), { kind: 'help' })
    assert.deepEqual(parseArgv(['-h']), { kind: 'help' })
    assert.deepEqual(parseArgv(['help']), { kind: 'help' })
  })
})
