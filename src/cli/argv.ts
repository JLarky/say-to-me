export type CliNode = {
  name: string
  summary: string
  children: ReadonlyArray<CliNode>
}

export const pairNewCommand: CliNode = {
  name: 'new',
  summary: 'Issue a pairing code on RELAY_URL and record the client',
  children: [],
}

export const pairCommand: CliNode = {
  name: 'pair',
  summary: 'Pair a client with this daemon',
  children: [pairNewCommand],
}

export const rootCommand: CliNode = {
  name: 'say-to-me2',
  summary: 'say-to-me2 CLI',
  children: [pairCommand],
}

export function usageFor(node: CliNode, path: ReadonlyArray<string> = []): string {
  const invoked = [rootCommand.name, ...path].join(' ')
  const command = node.children.length === 0 ? '' : ' <command>'

  return `Usage: ${invoked}${command}

  -h, --help    Print this usage`
}

export const cliUsage = usageFor(rootCommand)

export type ParsedCli =
  | { kind: 'help'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'run'; path: ReadonlyArray<string> }

function isHelp(value: string): boolean {
  return value === '--help' || value === '-h'
}

export function parseArgv(
  argv: ReadonlyArray<string>,
  node: CliNode = rootCommand,
  path: ReadonlyArray<string> = [],
): ParsedCli {
  const [head, ...rest] = argv

  if (head === undefined) {
    if (node.children.length === 0 && path.length > 0) {
      return { kind: 'run', path }
    }

    return { kind: 'error', message: usageFor(node, path) }
  }

  if (isHelp(head) && rest.length === 0) {
    return { kind: 'help', message: usageFor(node, path) }
  }

  if (isHelp(head)) {
    return {
      kind: 'error',
      message: `unexpected arguments: ${rest.join(' ')}\n${usageFor(node, path)}`,
    }
  }

  const child = node.children.find((candidate) => candidate.name === head)

  if (child === undefined) {
    return {
      kind: 'error',
      message: `unknown command: ${head}\n${usageFor(node, path)}`,
    }
  }

  return parseArgv(rest, child, path.concat(head))
}
