import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { describe, it } from 'node:test'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { Schema } from 'effect'
import { WebSocketServer, type WebSocket } from 'ws'
import { decodeJsonText } from '../../decode-response-json.ts'
import { relayRoundTrip } from './round-trip.ts'

type ForwardMode = 'pipe' | 'mismatch' | 'hang'

type Forwarder = {
  baseWs: string
  server: WebSocketServer
  urls: string[]
  helloKey: string
}

const HelloFrame = Type.Object({
  type: Type.Union([Type.Literal('hello'), Type.Literal('e2ee_hello')]),
  key: Type.String()
})

const RoundTripFrame = Type.Object({
  type: Type.Literal('roundtrip'),
  payload: Type.String()
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

  return Buffer.from(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  ).toString('utf8')
}

function maybeCorrupt(text: string, mode: ForwardMode) {
  if (mode !== 'mismatch') {
    return text
  }

  try {
    const parsed = decodeJsonText(text, Schema.Json)

    if (!Value.Check(RoundTripFrame, parsed)) {
      return text
    }

    return JSON.stringify({
      type: 'roundtrip',
      payload: `not-${parsed.payload}`
    })
  } catch {
    return text
  }
}

function captureHello(forwarder: Forwarder, text: string) {
  try {
    const parsed = decodeJsonText(text, Schema.Json)

    if (Value.Check(HelloFrame, parsed) && forwarder.helloKey === '') {
      forwarder.helloKey = parsed.key
    }
  } catch {
    return
  }
}

function pipeSockets(left: WebSocket, right: WebSocket, mode: ForwardMode) {
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

function attachPairing(forwarder: Forwarder, mode: ForwardMode) {
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

async function listenForwarder(mode: ForwardMode): Promise<Forwarder> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })

  if (server.address() === null) {
    await once(server, 'listening')
  }

  const forwarder: Forwarder = {
    baseWs: `ws://127.0.0.1:${listeningPort(server)}/ws`,
    server,
    urls: [],
    helloKey: ''
  }

  attachPairing(forwarder, mode)

  return forwarder
}

function closeForwarder(server: WebSocketServer) {
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

function assertV2Pair(urls: string[], serverId: string) {
  assert.equal(urls.length, 3)

  const parsed = urls.map((value) => new URL(value, 'ws://127.0.0.1'))

  for (const url of parsed) {
    assert.equal(url.pathname, '/ws')
    assert.equal(url.searchParams.get('v'), '2')
    assert.equal(url.searchParams.get('serverId'), serverId)
  }

  const control = parsed.find(
    (url) =>
      url.searchParams.get('role') === 'server' &&
      url.searchParams.get('connectionId') === null
  )

  const client = parsed.find((url) => url.searchParams.get('role') === 'client')

  const serverData = parsed.find(
    (url) =>
      url.searchParams.get('role') === 'server' &&
      url.searchParams.get('connectionId') !== null
  )

  assert.ok(control)
  assert.ok(client)
  assert.ok(serverData)

  assert.equal(
    client.searchParams.get('connectionId'),
    serverData.searchParams.get('connectionId')
  )
}

function assertCanonicalX25519Key(key: string) {
  const raw = Buffer.from(key, 'base64')

  assert.equal(raw.byteLength, 32)
  assert.equal(key, raw.toString('base64'))
}

describe('relayRoundTrip', () => {
  it('round-trips through an in-process v2 forwarder', async () => {
    const forwarder = await listenForwarder('pipe')

    try {
      const result = await relayRoundTrip(forwarder.baseWs, 'round-trip-payload')

      assert.match(result.serverId, /^say-to-me2-[0-9a-f]+$/)
      assertV2Pair(forwarder.urls, result.serverId)
      assertCanonicalX25519Key(forwarder.helloKey)
    } finally {
      await closeForwarder(forwarder.server)
    }
  })

  it('throws when the peer echoes a different payload', async () => {
    const forwarder = await listenForwarder('mismatch')

    try {
      await assert.rejects(
        () => relayRoundTrip(forwarder.baseWs, 'round-trip-payload'),
        /relay echoed a different payload/
      )
    } finally {
      await closeForwarder(forwarder.server)
    }
  })

  it('times out when a peer hangs', async () => {
    const forwarder = await listenForwarder('hang')
    const started = Date.now()

    try {
      await assert.rejects(
        () => relayRoundTrip(forwarder.baseWs, 'round-trip-payload', 200),
        /relay round-trip timed out/
      )
      assert.ok(Date.now() - started < 1000)
    } finally {
      await closeForwarder(forwarder.server)
    }
  })
})
