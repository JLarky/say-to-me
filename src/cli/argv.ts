export type CliNode = {
  name: string
  summary: string
  children: ReadonlyArray<CliNode>
}

export const rootCommand: CliNode = {
  name: 'say-to-me2',
  summary: 'say-to-me2 CLI',
  children: [],
}

export function usageFor(node: CliNode, path: ReadonlyArray<string> = []): string {
  const invoked = [rootCommand.name, ...path].join(' ')

  return `Usage: ${invoked} <command>

  -h, --help    Print this usage`
}

export const cliUsage = usageFor(rootCommand)

export type ParsedCli = { kind: 'help'; message: string } | { kind: 'error'; message: string }

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
