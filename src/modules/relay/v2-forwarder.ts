import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { Schema } from 'effect'
import { WebSocketServer, type WebSocket } from 'ws'
import { decodeJsonText } from '../../decode-response-json.ts'

export type V2ForwardMode = 'pipe' | 'mismatch' | 'hang'

export type V2Forwarder = {
  origin: string
  baseWs: string
  server: WebSocketServer
  urls: string[]
  helloKey: string
}

const HelloFrame = Schema.Struct({
  type: Schema.Literals(['hello', 'e2ee_hello']),
  key: Schema.String,
})

const RoundTripFrame = Schema.Struct({
  type: Schema.Literal('roundtrip'),
  payload: Schema.String,
})

function isAddressInfo(value: AddressInfo | string): value is AddressInfo {
  return Object(value) === value
}

function listeningPort(server: WebSocketServer) {
  const address = server.address()

  if (address === null) {
    throw new Error('websocket server is not listening')
  }

  if (isAddressInfo(address)) {
    return address.port
  }

  throw new Error('websocket server is not bound to a TCP port')
}

function socketText(data: Buffer | ArrayBuffer | ArrayBufferView | Buffer[]) {
  if (Array.isArray(data)) {
    throw new Error('websocket message is not text')
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8')
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }

  return Buffer.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).toString('utf8')
}

function maybeCorrupt(text: string, mode: V2ForwardMode) {
  if (mode !== 'mismatch') {
    return text
  }

  try {
    const parsed = decodeJsonText(text, RoundTripFrame)

    return JSON.stringify({
      type: 'roundtrip',
      payload: `not-${parsed.payload}`,
    })
  } catch {
    return text
  }
}

function captureHello(forwarder: V2Forwarder, text: string) {
  try {
    const parsed = decodeJsonText(text, HelloFrame)

    if (forwarder.helloKey === '') {
      forwarder.helloKey = parsed.key
    }
  } catch {
    return
  }
}

function pipeSockets(left: WebSocket, right: WebSocket, mode: V2ForwardMode) {
  if (mode === 'hang') {
    return
  }

  left.on('message', (data) => {
    right.send(maybeCorrupt(socketText(data), mode))
  })

  right.on('message', (data) => {
    left.send(maybeCorrupt(socketText(data), mode))
  })
}

function attachPairing(forwarder: V2Forwarder, mode: V2ForwardMode) {
  const waiting = new Map<string, WebSocket>()

  forwarder.server.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'ws://127.0.0.1')

    forwarder.urls.push(`${url.pathname}${url.search}`)

    const role = url.searchParams.get('role')
    const connectionId = url.searchParams.get('connectionId')

    if (role === 'server' && connectionId === null) {
      socket.send(JSON.stringify({ type: 'connected' }))

      return
    }

    if (connectionId === null) {
      return
    }

    socket.on('message', (data) => {
      captureHello(forwarder, socketText(data))
    })

    const peer = waiting.get(connectionId)

    if (peer === undefined) {
      waiting.set(connectionId, socket)

      return
    }

    waiting.delete(connectionId)
    pipeSockets(peer, socket, mode)
  })
}

export async function listenV2Forwarder(mode: V2ForwardMode): Promise<V2Forwarder> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })

  if (server.address() === null) {
    await once(server, 'listening')
  }

  const port = listeningPort(server)

  const forwarder: V2Forwarder = {
    origin: `http://127.0.0.1:${port}`,
    baseWs: `ws://127.0.0.1:${port}/ws`,
    server,
    urls: [],
    helloKey: '',
  }

  attachPairing(forwarder, mode)

  return forwarder
}

export function closeV2Forwarder(server: WebSocketServer) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)

        return
      }

      resolve()
    })
  })
}
