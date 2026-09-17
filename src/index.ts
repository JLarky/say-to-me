import { createRuntimeApp } from './runtime.ts'
import { loadEnv } from './config.ts'
import { readCounterDev, type CounterHmrListenInfo } from './modules/counter/counter-dev.ts'

const env = loadEnv()

const app = await createRuntimeApp()

app.listen(
  {
    port: env.PORT,
    hostname: env.HOST,
  },
  async (serverInfo) => {
    const host = serverInfo.hostname === '0.0.0.0' ? '127.0.0.1' : serverInfo.hostname
    console.log(`say-to-me2 listening on http://${host}:${serverInfo.port}`)
    console.log(`health   http://${host}:${serverInfo.port}/health`)
    console.log(`relay    http://${host}:${serverInfo.port}/relay`)
    console.log(`openapi  http://${host}:${serverInfo.port}/openapi`)
    console.log(`counter  http://${host}:${serverInfo.port}/counter`)

    const counterDev = readCounterDev()

    if (counterDev.kind === 'prod') {
      return
    }

    if (counterDev.kind === 'middleware') {
      console.log('counter HMR: middleware (Vite createServer on this http.Server)')
    } else {
      console.log(`counter HMR: proxy ${counterDev.origin}`)
    }

    const { attachCounterHmr } = await import('./modules/counter/vite-dev.ts')
    // SAFETY: @elysiajs/node spreads srvx as node.server and raw.node.server on this callback.
    await attachCounterHmr(counterDev, serverInfo as CounterHmrListenInfo)
  },
)
