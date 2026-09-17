import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Elysia } from 'elysia'

const counterPage = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.html'), 'utf8')

export const counter = new Elysia({ name: 'counter' }).get(
  '/counter',
  () =>
    new Response(counterPage, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    }),
  {
    detail: {
      tags: ['ops'],
      summary: 'Click counter',
      description:
        'HTML page with a lift-html/solid custom element. The count stays in the tab.',
    },
  },
)
