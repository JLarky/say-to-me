import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Elysia } from 'elysia'
import { counterScriptSrc, readCounterDev } from './counter-dev.ts'

const counterDir = dirname(fileURLToPath(import.meta.url))

const counterPage = readFileSync(join(counterDir, 'page.html'), 'utf8')

function isEnoent(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function counterScript(): Response {
  try {
    return new Response(readFileSync(join(counterDir, 'dist/counter.js'), 'utf8'), {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
      },
    })
  } catch (error) {
    if (isEnoent(error)) {
      return new Response('counter script is not built', {
        status: 503,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }

    throw error
  }
}

function counterPageHtml() {
  return counterPage.replace('src="/counter.js"', `src="${counterScriptSrc(readCounterDev())}"`)
}

export const counter = new Elysia({ name: 'counter' })
  .get(
    '/counter',
    () =>
      new Response(counterPageHtml(), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      }),
    {
      detail: {
        tags: ['ops'],
        summary: 'Click counter',
        description:
          'HTML page with a lift-html/solid custom element written in Solid JSX. The count stays in the tab.',
      },
    },
  )
  .get('/counter.js', () => counterScript(), {
    detail: {
      tags: ['ops'],
      summary: 'Click counter script',
      description: 'Vite+ build of the Solid JSX counter (`vp build`).',
    },
  })
