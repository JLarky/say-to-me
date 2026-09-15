const defaultPort = 43141
const parsedPort = Number(process.env.PORT ?? defaultPort)

if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
  throw new Error(`PORT must be a positive integer, got ${process.env.PORT}`)
}

export const config = {
  port: parsedPort,
  hostname: process.env.HOST ?? '0.0.0.0'
} as const
