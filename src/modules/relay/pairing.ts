import { Schema } from 'effect'
import { WebSocket } from 'ws'
import { decodeJsonText } from '../../decode-response-json.ts'
import { relayPointers, type RelayPointers } from '../../config.ts'
import {
  randomId,
  rethrowCause,
  socketUrl,
  waitMatchingFrame,
  waitOpen,
  x25519PublicKeyB64,
} from './ws.ts'

export const pairingTimeoutMs = 3_000

const HelloFrame = Schema.Struct({
  type: Schema.Literals(['hello', 'e2ee_hello']),
  key: Schema.String,
})

const PairFrame = Schema.Struct({
  type: Schema.Literal('pair'),
  clientId: Schema.NonEmptyString,
})

const SocketFrame = Schema.Union([HelloFrame, PairFrame])

type HelloFrame = typeof HelloFrame.Type

type PairFrame = typeof PairFrame.Type

type SocketFrame = typeof SocketFrame.Type

export const PairingCodePayload = Schema.Struct({
  v: Schema.Literal(1),
  clientId: Schema.NonEmptyString,
  serverId: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
  relay: Schema.NonEmptyString,
})

export type PairingCodePayload = typeof PairingCodePayload.Type

export type IssuedPairing = {
  clientId: string
  serverId: string
  code: string
  relay: RelayPointers & { url: string }
}

function isHelloFrame(value: SocketFrame): value is HelloFrame {
  return value.type === 'hello' || value.type === 'e2ee_hello'
}

function isPairFrame(value: SocketFrame): value is PairFrame {
  return value.type === 'pair'
}

export function encodePairingCode(payload: PairingCodePayload): string {
  const jsonText = Schema.encodeUnknownSync(Schema.fromJsonString(PairingCodePayload))(payload)

  return Schema.encodeUnknownSync(Schema.StringFromBase64Url)(jsonText)
}

export function decodePairingCode(code: string): PairingCodePayload {
  if (code.trim().length === 0) {
    throw new Error('pairing code is empty')
  }

  const jsonText = Schema.decodeUnknownSync(Schema.StringFromBase64Url)(code)

  return decodeJsonText(jsonText, PairingCodePayload)
}

async function waitHello(ws: WebSocket, key: string, signal: AbortSignal) {
  const hello = await waitMatchingFrame(ws, 'e2ee_hello', SocketFrame, isHelloFrame, signal)

  if (hello.key !== key) {
    throw new Error('hello key mismatch')
  }

  return hello
}

function waitPair(ws: WebSocket, label: string, signal: AbortSignal) {
  return waitMatchingFrame(ws, label, SocketFrame, isPairFrame, signal)
}

export async function issueRelayPairing(
  relayUrl: string,
  timeoutMs = pairingTimeoutMs,
): Promise<IssuedPairing> {
  const pointers = relayPointers(relayUrl)
  const serverId = randomId('say-to-me2')
  const clientId = randomId('clt')
  const key = x25519PublicKeyB64()
  const signal = AbortSignal.timeout(timeoutMs)
  const control = new WebSocket(socketUrl(pointers.ws, 'server', serverId))
  const client = new WebSocket(socketUrl(pointers.ws, 'client', serverId, clientId))
  const serverData = new WebSocket(socketUrl(pointers.ws, 'server', serverId, clientId))

  try {
    await Promise.all([
      waitOpen(control, 'server-control', signal),
      waitOpen(serverData, 'server-data', signal),
      waitOpen(client, 'client', signal),
    ])

    const hello = waitHello(serverData, key, signal)

    client.send(JSON.stringify({ type: 'e2ee_hello', key }))
    await hello

    const inbound = waitPair(serverData, 'pair', signal)

    client.send(JSON.stringify({ type: 'pair', clientId }))

    const received = await inbound

    if (received.clientId !== clientId) {
      throw new Error('relay echoed a different pairing client')
    }

    const echo = waitPair(client, 'pair-echo', signal)

    serverData.send(JSON.stringify(received))

    const echoed = await echo

    if (echoed.clientId !== clientId) {
      throw new Error('relay echoed a different pairing client')
    }

    const payload: PairingCodePayload = {
      v: 1,
      clientId,
      serverId,
      key,
      relay: relayUrl,
    }

    return {
      clientId,
      serverId,
      code: encodePairingCode(payload),
      relay: {
        ...pointers,
        url: relayUrl,
      },
    }
  } catch (cause) {
    if (signal.aborted) {
      throw new Error('relay pairing timed out')
    }

    rethrowCause(cause)
  } finally {
    control.terminate()
    client.terminate()
    serverData.terminate()
  }
}
