import { randomBytes, generateKeyPairSync } from 'node:crypto'
import { on, once } from 'node:events'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { WebSocket } from 'ws'

export const roundTripTimeoutMs = 3_000

const HelloFrame = Type.Object({
  type: Type.Union([Type.Literal('hello'), Type.Literal('e2ee_hello')]),
  key: Type.String()
})

const RoundTripFrame = Type.Object({
  type: Type.Literal('roundtrip'),
  payload: Type.String()
})

export type RelayRoundTripResult = {
  serverId: string
}

function x25519PublicKeyB64() {
  const { publicKey } = generateKeyPairSync('x25519')
  const jwk = publicKey.export({ format: 'jwk' })

  if (!('x' in jwk) || jwk.x === undefined) {
    throw new Error('X25519 public key is missing')
  }

  const raw = Buffer.from(jwk.x, 'base64url')

  if (raw.byteLength !== 32) {
    throw new Error('X25519 public key must be 32 bytes')
  }

  return raw.toString('base64')
}

function randomId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString('hex')}`
}

export function randomPayload() {
  return randomBytes(16).toString('hex')
}

function messageText(data: Buffer | ArrayBuffer | ArrayBufferView | Buffer[]) {
  if (Array.isArray(data)) {
    throw new Error('websocket message is not text')
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8')
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data)
  }

  return new TextDecoder().decode(data)
}

function parseSocketJson(data: Buffer | ArrayBuffer | ArrayBufferView | Buffer[]) {
  try {
    return JSON.parse(messageText(data))
  } catch {
    return undefined
  }
}

function isHelloFrame(value: unknown): value is Static<typeof HelloFrame> {
  return Value.Check(HelloFrame, value)
}

function isRoundTripFrame(
  value: unknown
): value is Static<typeof RoundTripFrame> {
  return Value.Check(RoundTripFrame, value)
}

function rethrowCause(cause: unknown): never {
  if (cause instanceof Error) {
    throw cause
  }

  throw new Error('relay round-trip failed')
}

async function waitOpen(ws: WebSocket, label: string, signal: AbortSignal) {
  if (ws.readyState === WebSocket.OPEN) {
    return
  }

  if (ws.readyState !== WebSocket.CONNECTING) {
    throw new Error(`${label} websocket closed before open`)
  }

  const local = new AbortController()
  const combined = AbortSignal.any([signal, local.signal])
  const closed = once(ws, 'close', { signal: combined }).then(() => {
    throw new Error(`${label} websocket closed before open`)
  })

  try {
    await Promise.race([once(ws, 'open', { signal: combined }), closed])
  } catch (cause) {
    if (signal.aborted) {
      throw new Error(`Timed out opening ${label} websocket`)
    }

    rethrowCause(cause)
  } finally {
    local.abort()
    void closed.catch(() => undefined)
  }
}

async function waitMatchingFrame<T>(
  ws: WebSocket,
  label: string,
  match: (value: unknown) => value is T,
  signal: AbortSignal
) {
  const local = new AbortController()
  const closed = () => {
    local.abort()
  }

  ws.once('close', closed)

  try {
    for await (const event of on(ws, 'message', {
      signal: AbortSignal.any([signal, local.signal])
    })) {
      const parsed = parseSocketJson(event[0])

      if (parsed === undefined) {
        continue
      }

      if (match(parsed)) {
        return parsed
      }
    }
  } catch {
    if (signal.aborted) {
      throw new Error(`Timed out waiting for ${label}`)
    }

    throw new Error(`${label} websocket closed`)
  } finally {
    ws.off('close', closed)
    local.abort()
  }

  throw new Error(`${label} websocket closed`)
}

async function waitHello(ws: WebSocket, key: string, signal: AbortSignal) {
  const hello = await waitMatchingFrame(ws, 'e2ee_hello', isHelloFrame, signal)

  if (hello.key !== key) {
    throw new Error('hello key mismatch')
  }

  return hello
}

function waitRoundTrip(ws: WebSocket, label: string, signal: AbortSignal) {
  return waitMatchingFrame(ws, label, isRoundTripFrame, signal)
}

function socketUrl(
  baseWs: string,
  role: 'server' | 'client',
  serverId: string,
  connectionId?: string
) {
  const url = new URL(baseWs)

  url.searchParams.set('role', role)
  url.searchParams.set('serverId', serverId)
  url.searchParams.set('v', '2')

  if (connectionId !== undefined) {
    url.searchParams.set('connectionId', connectionId)
  }

  return url.toString()
}

export async function relayRoundTrip(
  baseWs: string,
  payload: string,
  timeoutMs = roundTripTimeoutMs
): Promise<RelayRoundTripResult> {
  const serverId = randomId('say-to-me2')
  const connectionId = randomId('clt')
  const key = x25519PublicKeyB64()
  const signal = AbortSignal.timeout(timeoutMs)
  const control = new WebSocket(socketUrl(baseWs, 'server', serverId))

  const client = new WebSocket(
    socketUrl(baseWs, 'client', serverId, connectionId)
  )

  const serverData = new WebSocket(
    socketUrl(baseWs, 'server', serverId, connectionId)
  )

  try {
    await Promise.all([
      waitOpen(control, 'server-control', signal),
      waitOpen(serverData, 'server-data', signal),
      waitOpen(client, 'client', signal)
    ])

    const hello = waitHello(serverData, key, signal)

    client.send(JSON.stringify({ type: 'e2ee_hello', key }))
    await hello

    const inbound = waitRoundTrip(serverData, 'roundtrip', signal)

    client.send(JSON.stringify({ type: 'roundtrip', payload }))

    const received = await inbound

    const echo = waitRoundTrip(client, 'echo', signal)

    serverData.send(JSON.stringify(received))

    const echoed = await echo

    if (echoed.payload !== payload) {
      throw new Error('relay echoed a different payload')
    }

    return { serverId }
  } catch (cause) {
    if (signal.aborted) {
      throw new Error('relay round-trip timed out')
    }

    rethrowCause(cause)
  } finally {
    control.terminate()
    client.terminate()
    serverData.terminate()
  }
}
