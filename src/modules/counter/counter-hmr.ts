import { render } from 'solid-js/web'
import { CounterPage, registerCounter } from './counter-view.tsx'

type CounterHotData = {
  dispose?: () => void
}

function hotDispose(data: CounterHotData) {
  return data.dispose
}

registerCounter()

const root = document.getElementById('app')

if (!root) {
  throw new Error('#app is missing from the counter page')
}

const hot = import.meta.hot

if (hot) {
  hotDispose(hot.data)?.()
}

const dispose = render(CounterPage, root)

if (hot) {
  hot.data.dispose = dispose
  hot.accept()
}
