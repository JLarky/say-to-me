import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cliUsage, pairCommand, pairNewCommand, parseArgv, usageFor } from './argv.ts'

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

  it('rejects a missing pair subcommand', () => {
    assert.deepEqual(parseArgv(['pair']), {
      kind: 'error',
      message: usageFor(pairCommand, ['pair']),
    })
  })

  it('rejects unknown pair subcommands', () => {
    const parsed = parseArgv(['pair', 'list'])

    assert.equal(parsed.kind, 'error')

    if (parsed.kind === 'error') {
      assert.match(parsed.message, /unknown command: list/)
    }
  })

  it('rejects extra arguments after pair new', () => {
    const parsed = parseArgv(['pair', 'new', '--json'])

    assert.equal(parsed.kind, 'error')

    if (parsed.kind === 'error') {
      assert.match(parsed.message, /unknown command: --json/)
    }
  })

  it('accepts pair new', () => {
    assert.deepEqual(parseArgv(['pair', 'new']), { kind: 'run', path: ['pair', 'new'] })
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

  it('prints help for pair --help and pair new --help', () => {
    assert.deepEqual(parseArgv(['pair', '--help']), {
      kind: 'help',
      message: usageFor(pairCommand, ['pair']),
    })
    assert.deepEqual(parseArgv(['pair', 'new', '--help']), {
      kind: 'help',
      message: usageFor(pairNewCommand, ['pair', 'new']),
    })
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
