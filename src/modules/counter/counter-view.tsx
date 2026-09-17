import { createSignal, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { liftSolid } from '@lift-html/solid'

declare module 'solid-js' {
  namespace JSX {
    interface IntrinsicElements {
      'say-to-me2-counter': JSX.HTMLAttributes<HTMLElement>
    }
  }
}

const tagName = 'say-to-me2-counter'

export function CounterView(): JSX.Element {
  const [count, setCount] = createSignal(0)

  return (
    <>
      <button type="button" aria-label="Decrease count" onClick={() => setCount((n) => n - 1)}>
        −
      </button>
      <output aria-live="polite">{count()}</output>
      <button type="button" aria-label="Increase count" onClick={() => setCount((n) => n + 1)}>
        +
      </button>
    </>
  )
}

export function registerCounter() {
  if (customElements.get(tagName)) {
    return
  }

  liftSolid(tagName, {
    init(onCleanup) {
      onCleanup(render(() => <CounterView />, this))
    },
  })
}

export function CounterPage(): JSX.Element {
  return (
    <main>
      <h1>Click counter</h1>
      <p class="lede">
        Served by this say-to-me2 process. The count lives in the tab, driven by a{' '}
        <a href="https://lift-html.js.org/examples/solid-counter/">lift-html/solid</a> custom
        element written in Solid JSX.
      </p>
      <say-to-me2-counter />
      <p class="hint">Plus and minus. Nothing is stored on the server.</p>
    </main>
  )
}
