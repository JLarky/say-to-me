import { randomBytes, generateKeyPairSync } from 'node:crypto'
import { WebSocket } from 'ws'
import { Value } from '@sinclair/typebox/value'
import { t } from 'elysia'

const handshakeTimeoutMs = 8_000

const HelloFrame = t.Object({
  type: t.Union([t.Literal('hello'), t.Literal('e2ee_hello')]),
  key: t.String()
})

const RoundTripFrame = t.Object({
  type: t.Literal('roundtrip'),
  payload: t.String()
})

export type RelayRoundTripResult = {
  serverId: string
  payload: string
  echoed: string
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

function messageText(data: WebSocket.RawData) {
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data)
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data)
  }

  return `${data}`
}

function isHelloFrame(
  value: unknown
): value is { type: 'hello' | 'e2ee_hello'; key: string } {
  return Value.Check(HelloFrame, value)
}

function isRoundTripFrame(
  value: unknown
): value is { type: 'roundtrip'; payload: string } {
  return Value.Check(RoundTripFrame, value)
}

function waitOpen(ws: WebSocket, label: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out opening ${label} websocket`))
    }, handshakeTimeoutMs)

    const fail = (cause: Error) => {
      clearTimeout(timer)
      reject(cause)
    }

    const onClose = () => {
      fail(new Error(`${label} websocket closed before open`))
    }

    const onOpen = () => {
      clearTimeout(timer)
      ws.off('close', onClose)
      resolve()
    }

    ws.once('open', onOpen)
    ws.once('error', fail)
    ws.once('close', onClose)
  })
}

function waitHello(ws: WebSocket) {
  return waitMatchingFrame(ws, 'e2ee_hello', isHelloFrame)
}

function waitRoundTrip(ws: WebSocket, label: string) {
  return waitMatchingFrame(ws, label, isRoundTripFrame)
}

function waitMatchingFrame<T>(
  ws: WebSocket,
  label: string,
  match: (value: unknown) => value is T
) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}`))
    }, handshakeTimeoutMs)

    const onMessage = (data: WebSocket.RawData) => {
      let parsed: unknown

      try {
        parsed = JSON.parse(messageText(data))
      } catch {
        return
      }

      if (!match(parsed)) {
        return
      }

      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(parsed)
    }

    ws.on('message', onMessage)
    ws.once('error', (cause: Error) => {
      clearTimeout(timer)
      reject(cause)
    })
    ws.once('close', () => {
      clearTimeout(timer)
      reject(new Error(`${label} websocket closed`))
    })
  })
}

function closeQuietly(ws: WebSocket) {
  try {
    ws.close()
  } catch {
    ws.terminate()
  }
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
  payload: string
): Promise<RelayRoundTripResult> {
  const serverId = randomId('say-to-me2')
  const connectionId = randomId('clt')
  const key = x25519PublicKeyB64()
  const control = new WebSocket(socketUrl(baseWs, 'server', serverId))

  const client = new WebSocket(
    socketUrl(baseWs, 'client', serverId, connectionId)
  )

  const serverData = new WebSocket(
    socketUrl(baseWs, 'server', serverId, connectionId)
  )

  try {
    await Promise.all([
      waitOpen(control, 'server-control'),
      waitOpen(serverData, 'server-data'),
      waitOpen(client, 'client')
    ])

    client.send(JSON.stringify({ type: 'e2ee_hello', key }))
    await waitHello(serverData)

    client.send(JSON.stringify({ type: 'roundtrip', payload }))

    const inbound = await waitRoundTrip(serverData, 'roundtrip')

    serverData.send(JSON.stringify(inbound))

    const echoed = await waitRoundTrip(client, 'echo')

    if (echoed.payload !== payload) {
      throw new Error('relay echoed a different payload')
    }

    return {
      serverId,
      payload,
      echoed: echoed.payload
    }
  } finally {
    closeQuietly(control)
    closeQuietly(client)
    closeQuietly(serverData)
  }
}
