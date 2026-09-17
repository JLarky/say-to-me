import {
  request as httpRequest,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'
import {
  readNodeHttpServer,
  viteHmrPath,
  type CounterDev,
  type CounterHmrListenInfo,
} from './counter-dev.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

type CounterHmr = Exclude<CounterDev, { kind: 'prod' }>

type ServerListener = ReturnType<HttpServer['listeners']>[number]

export async function attachCounterHmr(counterDev: CounterHmr, listenInfo: CounterHmrListenInfo) {
  const httpServer = readNodeHttpServer(listenInfo)

  if (counterDev.kind === 'middleware') {
    await attachViteMiddleware(httpServer)

    return
  }

  attachViteProxy(httpServer, counterDev.origin)
}

function requestPathname(url: string | undefined) {
  return new URL(url ?? '/', 'http://127.0.0.1').pathname
}

function isViteDevPath(pathname: string) {
  return (
    pathname.startsWith('/@') ||
    pathname.startsWith('/src/') ||
    pathname.startsWith('/node_modules/') ||
    pathname === viteHmrPath ||
    pathname.startsWith(`${viteHmrPath}/`) ||
    pathname.startsWith('/.vite')
  )
}

function isHopByHopHeader(name: string) {
  switch (name) {
    case 'connection':
    case 'keep-alive':
    case 'proxy-authenticate':
    case 'proxy-authorization':
    case 'te':
    case 'trailers':
    case 'transfer-encoding':
    case 'upgrade':
    case 'host':
      return true
    default:
      return false
  }
}

function copyIncomingHeaders(req: IncomingMessage) {
  const headers = new Headers()

  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || isHopByHopHeader(name)) {
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item)
      }
    } else {
      headers.set(name, value)
    }
  }

  return headers
}

async function proxyViteHttp(req: IncomingMessage, res: ServerResponse, origin: string) {
  const target = new URL(req.url ?? '/', origin)

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: copyIncomingHeaders(req),
      redirect: 'manual',
    })

    res.statusCode = upstream.status
    const contentType = upstream.headers.get('content-type')

    if (contentType !== null) {
      res.setHeader('content-type', contentType)
    }

    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch {
    res.statusCode = 502
    res.end('vite proxy failed')
  }
}

function originPort(origin: URL) {
  if (origin.port !== '') {
    return Number(origin.port)
  }

  if (origin.protocol === 'https:') {
    return 443
  }

  return 80
}

function proxyViteUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, origin: string) {
  const target = new URL(origin)

  const proxyReq = httpRequest({
    hostname: target.hostname,
    port: originPort(target),
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host,
    },
  })

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const lines = ['HTTP/1.1 101 Switching Protocols']

    for (const [name, value] of Object.entries(proxyRes.headers)) {
      if (value === undefined) {
        continue
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          lines.push(`${name}: ${item}`)
        }
      } else {
        lines.push(`${name}: ${value}`)
      }
    }

    socket.write(`${lines.join('\r\n')}\r\n\r\n`)

    if (head.length > 0) {
      socket.unshift(head)
    }

    if (proxyHead.length > 0) {
      proxySocket.unshift(proxyHead)
    }

    proxySocket.pipe(socket)
    socket.pipe(proxySocket)
  })

  proxyReq.on('error', () => {
    socket.destroy()
  })

  socket.on('error', () => {
    proxyReq.destroy()
  })

  proxyReq.end()
}

function putViteHttpInFront(
  httpServer: HttpServer,
  handle: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
) {
  const elysiaListeners = httpServer.listeners('request').slice()
  httpServer.removeAllListeners('request')
  httpServer.on('request', (req, res) => {
    handle(req, res, () => {
      for (const listener of elysiaListeners) {
        listener.call(httpServer, req, res)
      }
    })
  })
}

function putViteUpgradeInFront(httpServer: HttpServer, before: ServerListener[]) {
  const after = httpServer.listeners('upgrade').slice()
  const viteUpgrade = after.filter((listener) => !before.includes(listener))

  httpServer.removeAllListeners('upgrade')
  httpServer.on('upgrade', (req, socket, head) => {
    const chosen = isViteDevPath(requestPathname(req.url)) ? viteUpgrade : before

    for (const listener of chosen) {
      listener.call(httpServer, req, socket, head)
    }
  })
}

async function attachViteMiddleware(httpServer: HttpServer) {
  const elysiaUpgrade = httpServer.listeners('upgrade').slice()

  const vite = await createServer({
    configFile: join(repoRoot, 'vite.config.ts'),
    appType: 'custom',
    server: {
      middlewareMode: { server: httpServer },
      ws: {
        path: viteHmrPath,
        server: httpServer,
      },
    },
  })

  putViteHttpInFront(httpServer, (req, res, next) => {
    vite.middlewares(req, res, next)
  })
  putViteUpgradeInFront(httpServer, elysiaUpgrade)
}

function attachViteProxy(httpServer: HttpServer, origin: string) {
  putViteHttpInFront(httpServer, (req, res, next) => {
    if (isViteDevPath(requestPathname(req.url))) {
      void proxyViteHttp(req, res, origin)

      return
    }

    next()
  })

  const elysiaUpgrade = httpServer.listeners('upgrade').slice()
  httpServer.removeAllListeners('upgrade')
  httpServer.on('upgrade', (req, socket, head) => {
    if (isViteDevPath(requestPathname(req.url))) {
      proxyViteUpgrade(req, socket, head, origin)

      return
    }

    for (const listener of elysiaUpgrade) {
      listener.call(httpServer, req, socket, head)
    }
  })
}
