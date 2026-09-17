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

  it('prints help for --help and -h', () => {
    assert.deepEqual(parseArgv(['--help']), { kind: 'help', message: cliUsage })
    assert.deepEqual(parseArgv(['-h']), { kind: 'help', message: cliUsage })
  })

  it('rejects help as an unknown command', () => {
    const parsed = parseArgv(['help'])

    assert.equal(parsed.kind, 'error')

    if (parsed.kind === 'error') {
      assert.match(parsed.message, /unknown command: help/)
    }
  })

  it('lists -h and --help on a <command> usage line', () => {
    assert.match(cliUsage, /Usage: say-to-me2 <command>/)
    assert.match(cliUsage, /-h, --help/)
  })
})
