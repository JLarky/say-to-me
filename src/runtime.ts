import { createApp } from './app'

export function isBunRuntime() {
  return typeof process.versions.bun === 'string'
}

export async function createRuntimeApp() {
  if (isBunRuntime()) {
    return createApp()
  }

  const { node } = await import('@elysiajs/node')
  return createApp({ adapter: node() })
}
