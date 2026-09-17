import { parseArgv } from './argv.ts'
import {
  defaultPairNewRequest,
  formatPairNewSuccess,
  pairNew,
  type PairNewRequest,
} from './pair-new.ts'

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

export async function runCli(
  argv: ReadonlyArray<string>,
  io: CliIo,
  pair: PairNewRequest = defaultPairNewRequest(),
): Promise<number> {
  const parsed = parseArgv(argv)

  if (parsed.kind === 'help') {
    io.writeStdout(`${parsed.message}\n`)

    return 0
  }

  if (parsed.kind === 'error') {
    io.writeStderr(`${parsed.message}\n`)

    return 1
  }

  const outcome = await pairNew(pair)

  if (!outcome.ok) {
    io.writeStderr(`${outcome.message}\n`)

    return 1
  }

  io.writeStdout(formatPairNewSuccess(outcome))

  return 0
}

export async function runCliProcess(argv: ReadonlyArray<string>): Promise<number> {
  return runCli(argv, processCliIo)
}
