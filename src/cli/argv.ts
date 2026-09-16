export const cliUsage = `Usage: say-to-me2 [--help]

Prints this help.`

export type ParsedCli = { kind: 'help' } | { kind: 'error'; message: string }

function isHelp(value: string): boolean {
  return value === '--help' || value === '-h' || value === 'help'
}

export function parseArgv(argv: ReadonlyArray<string>): ParsedCli {
  const [command, ...rest] = argv

  if (command === undefined) {
    return { kind: 'error', message: cliUsage }
  }

  if (isHelp(command) && rest.length === 0) {
    return { kind: 'help' }
  }

  if (isHelp(command)) {
    return { kind: 'error', message: `unexpected arguments: ${rest.join(' ')}\n${cliUsage}` }
  }

  return { kind: 'error', message: `unknown command: ${command}\n${cliUsage}` }
}
