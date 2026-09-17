import { parseArgv } from './argv.ts'

export type CliIo = {
  writeStdout: (text: string) => void
  writeStderr: (text: string) => void
}

export const processCliIo: CliIo = {
  writeStdout(text) {
    process.stdout.write(text)
  },
  writeStderr(text) {
    process.stderr.write(text)
  },
}

export function runCli(argv: ReadonlyArray<string>, io: CliIo): number {
  const parsed = parseArgv(argv)

  if (parsed.kind === 'help') {
    io.writeStdout(`${parsed.message}\n`)

    return 0
  }

  io.writeStderr(`${parsed.message}\n`)

  return 1
}

export function runCliProcess(argv: ReadonlyArray<string>): number {
  return runCli(argv, processCliIo)
}
