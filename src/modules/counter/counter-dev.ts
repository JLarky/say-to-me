import type { Server as HttpServer } from 'node:http'

export type CounterDev =
  | { kind: 'prod' }
  | { kind: 'middleware' }
  | { kind: 'proxy'; origin: string }

export type CounterHmrListenInfo = {
  node?: { server?: HttpServer }
  raw?: { node?: { server?: HttpServer } }
}

const viteHmrEntry = '/src/modules/counter/counter-hmr.ts'

export const viteHmrPath = '/__vite_hmr'

export function readCounterDev(env: NodeJS.ProcessEnv = process.env): CounterDev {
  const origin = env.COUNTER_VITE_ORIGIN

  if (origin !== undefined && origin !== '') {
    return { kind: 'proxy', origin }
  }

  if (env.COUNTER_HMR === 'middleware') {
    return { kind: 'middleware' }
  }

  return { kind: 'prod' }
}

export function counterScriptSrc(dev: CounterDev): string {
  switch (dev.kind) {
    case 'prod':
      return '/counter.js'
    case 'middleware':
    case 'proxy':
      return viteHmrEntry
  }
}

export function readNodeHttpServer(info: CounterHmrListenInfo): HttpServer {
  const server = info.node?.server ?? info.raw?.node?.server

  if (server === undefined) {
    throw new Error('Elysia listen did not expose a Node http.Server')
  }

  return server
}
