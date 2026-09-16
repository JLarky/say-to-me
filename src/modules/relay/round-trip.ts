import { randomBytes } from 'node:crypto'
import { Schema } from 'effect'
import { WebSocket } from 'ws'
import {
  randomId,
  rethrowCause,
  socketUrl,
  waitMatchingFrame,
  waitOpen,
  x25519PublicKeyB64,
} from './ws.ts'

export function randomPayload() {
  return randomBytes(16).toString('hex')
}

export const roundTripTimeoutMs = 3_000

const HelloFrame = Schema.Struct({
  type: Schema.Literals(['hello', 'e2ee_hello']),
  key: Schema.String,
})

const RoundTripFrame = Schema.Struct({
  type: Schema.Literal('roundtrip'),
  payload: Schema.String,
})

const SocketFrame = Schema.Union([HelloFrame, RoundTripFrame])

type HelloFrame = typeof HelloFrame.Type

type RoundTripFrame = typeof RoundTripFrame.Type

type SocketFrame = typeof SocketFrame.Type

export type RelayRoundTripResult = {
  serverId: string
}

function isHelloFrame(value: SocketFrame): value is HelloFrame {
  return value.type === 'hello' || value.type === 'e2ee_hello'
}

function isRoundTripFrame(value: SocketFrame): value is RoundTripFrame {
  return value.type === 'roundtrip'
}

async function waitHello(ws: WebSocket, key: string, signal: AbortSignal) {
  const hello = await waitMatchingFrame(ws, 'e2ee_hello', SocketFrame, isHelloFrame, signal)

  if (hello.key !== key) {
    throw new Error('hello key mismatch')
  }

  return hello
}

function waitRoundTrip(ws: WebSocket, label: string, signal: AbortSignal) {
  return waitMatchingFrame(ws, label, SocketFrame, isRoundTripFrame, signal)
}

export async function relayRoundTrip(
  baseWs: string,
  payload: string,
  timeoutMs = roundTripTimeoutMs,
): Promise<RelayRoundTripResult> {
  const serverId = randomId('say-to-me2')
  const connectionId = randomId('clt')
  const key = x25519PublicKeyB64()
  const signal = AbortSignal.timeout(timeoutMs)
  const control = new WebSocket(socketUrl(baseWs, 'server', serverId))

  const client = new WebSocket(socketUrl(baseWs, 'client', serverId, connectionId))

  const serverData = new WebSocket(socketUrl(baseWs, 'server', serverId, connectionId))

  try {
    await Promise.all([
      waitOpen(control, 'server-control', signal),
      waitOpen(serverData, 'server-data', signal),
      waitOpen(client, 'client', signal),
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
