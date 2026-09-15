import { createApp } from './app.ts'

export function isBunRuntime() {
  return 'bun' in process.versions
}

export async function createRuntimeApp() {
  if (isBunRuntime()) {
    return createApp()
  }

  const { node } = await import('@elysiajs/node')

  return createApp({ adapter: node() })
}
