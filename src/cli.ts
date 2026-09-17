import { runCliProcess } from './cli/main.ts'

process.exit(runCliProcess(process.argv.slice(2)))
