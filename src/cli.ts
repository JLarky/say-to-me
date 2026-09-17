import { runCliProcess } from './cli/main.ts'

process.exit(await runCliProcess(process.argv.slice(2)))
