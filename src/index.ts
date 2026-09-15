import { createRuntimeApp } from './runtime'
import { loadEnv } from './config'

const env = loadEnv()

const app = await createRuntimeApp()

app.listen(
  {
    port: env.PORT,
    hostname: env.HOST
  },
  ({ hostname, port }) => {
    const host = hostname === '0.0.0.0' ? '127.0.0.1' : hostname
    console.log(`say-to-me2 listening on http://${host}:${port}`)
    console.log(`health   http://${host}:${port}/health`)
    console.log(`relay    http://${host}:${port}/relay`)
    console.log(`openapi  http://${host}:${port}/openapi`)
  }
)
