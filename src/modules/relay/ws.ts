import { randomBytes, generateKeyPairSync } from 'node:crypto'
import { on, once } from 'node:events'
import { Schema } from 'effect'
import { WebSocket } from 'ws'
import { decodeJsonText } from '../../decode-response-json.ts'

export function randomId(prefix: string) {
  return `${prefix}-${randomBytes(8).toString('hex')}`
}

export function x25519PublicKeyB64() {
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

export function socketUrl(
  baseWs: string,
  role: 'server' | 'client',
  serverId: string,
  connectionId?: string,
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

export function rethrowCause(cause: unknown): never {
  if (cause instanceof Error) {
    throw cause
  }

  throw new Error('relay round-trip failed')
}

function messageText(data: Buffer | ArrayBuffer | ArrayBufferView | Buffer[]) {
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

export function parseSocketJson<S extends Schema.ConstraintDecoder<unknown>>(
  data: Buffer | ArrayBuffer | ArrayBufferView | Buffer[],
  schema: S,
): S['Type'] | undefined {
  try {
    return decodeJsonText(messageText(data), schema)
  } catch {
    return undefined
  }
}

export async function waitOpen(ws: WebSocket, label: string, signal: AbortSignal) {
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

export async function waitMatchingFrame<
  S extends Schema.ConstraintDecoder<unknown>,
  T extends S['Type'],
>(
  ws: WebSocket,
  label: string,
  schema: S,
  match: (value: S['Type']) => value is T,
  signal: AbortSignal,
): Promise<T> {
  const local = new AbortController()

  const closed = () => {
    local.abort()
  }

  ws.once('close', closed)

  try {
    for await (const event of on(ws, 'message', {
      signal: AbortSignal.any([signal, local.signal]),
    })) {
      const parsed = parseSocketJson(event[0], schema)

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
