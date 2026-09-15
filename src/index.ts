import { createRuntimeApp } from './runtime'
import { config } from './config'

const app = await createRuntimeApp()

app.listen(
  {
    port: config.port,
    hostname: config.hostname
  },
  ({ hostname, port }) => {
    const host = hostname === '0.0.0.0' ? '127.0.0.1' : hostname
    console.log(`say-to-me2 listening on http://${host}:${port}`)
    console.log(`health   http://${host}:${port}/health`)
    console.log(`relay    http://${host}:${port}/relay`)
    console.log(`openapi  http://${host}:${port}/openapi`)
  }
)
