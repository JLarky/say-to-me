import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cliUsage } from './argv.ts'
import { runCli } from './main.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

const binPath = join(repoRoot, 'bin/say-to-me2')

describe('runCli', () => {
  it('prints usage on an empty command line', () => {
    let stderr = ''

    const code = runCli([], {
      writeStdout() {},
      writeStderr(text) {
        stderr += text
      },
    })

    assert.equal(code, 1)
    assert.equal(stderr, `${cliUsage}\n`)
  })

  it('prints help on --help', () => {
    let stdout = ''

    const code = runCli(['--help'], {
      writeStdout(text) {
        stdout += text
      },
      writeStderr() {},
    })

    assert.equal(code, 0)
    assert.equal(stdout, `${cliUsage}\n`)
  })

  it('prints unknown command on stderr', () => {
    let stderr = ''

    const code = runCli(['status'], {
      writeStdout() {},
      writeStderr(text) {
        stderr += text
      },
    })

    assert.equal(code, 1)
    assert.match(stderr, /unknown command: status/)
  })
})

describe('bin/say-to-me2', () => {
  it('prints help and exits 0 for --help', () => {
    const result = spawnSync(binPath, ['--help'], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, `${cliUsage}\n`)
  })

  it('prints usage and exits 1 for an empty command line', () => {
    const result = spawnSync(binPath, [], { encoding: 'utf8' })

    assert.equal(result.status, 1)
    assert.equal(result.stderr, `${cliUsage}\n`)
  })

  it('exits 1 for an unknown command', () => {
    const result = spawnSync(binPath, ['status'], { encoding: 'utf8' })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /unknown command: status/)
  })
})
