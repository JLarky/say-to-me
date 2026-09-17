import { spawn } from 'node:child_process'

export type CapturedCommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type CapturedCommandRequest = {
  file: string
  args: ReadonlyArray<string>
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

function hasErrorCode(error: Error): error is NodeJS.ErrnoException {
  return 'code' in error
}

export function runCapturedCommand(
  request: CapturedCommandRequest,
): Promise<CapturedCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.file, [...request.args], {
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    const finish = (result: CapturedCommandResult) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({
        exitCode: 124,
        stdout,
        stderr: stderr.length === 0 ? 'command timed out' : `${stderr}\ncommand timed out`,
      })
    }, request.timeoutMs)

    child.once('error', (error) => {
      if (error instanceof Error && hasErrorCode(error) && error.code === 'ENOENT') {
        finish({
          exitCode: 127,
          stdout,
          stderr: `${request.file} not found on PATH`,
        })

        return
      }

      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      reject(error)
    })

    child.once('close', (code) => {
      finish({
        exitCode: code ?? 1,
        stdout,
        stderr,
      })
    })
  })
}
