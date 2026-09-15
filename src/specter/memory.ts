import type { EventLogAdapter, PersistedEvent, SliceStoreAdapter } from '@specter-ts/core'

type MemorySliceStore<TState> = ReturnType<SliceStoreAdapter<TState>['get']>

/**
 * In-process Specter adapters. Core has no persistence; this slice keeps an
 * event log and projections in memory for the lifetime of the process.
 */
export function createMemoryEventLog(): EventLogAdapter {
  const events: PersistedEvent[] = []

  const eventLog: EventLogAdapter = {
    query: (order, eventTypes) =>
      Promise.resolve(
        events.filter((event) => event.order > order && eventTypes.includes(event.type)),
      ),
    append: (drafts) => {
      const persisted = drafts.map((draft, index) => ({
        type: draft.type,
        payload: draft.payload,
        id: crypto.randomUUID(),
        recordedAt: new Date(),
        order: events.length + index + 1,
      }))

      events.push(...persisted)

      return Promise.resolve(persisted)
    },
    transaction: (run) => run(eventLog),
  }

  return eventLog
}

export function createMemorySliceStore<TState extends object>(
  createInitial: () => TState,
): SliceStoreAdapter<TState> {
  const entries = new Map<string, { state: TState; lastApplied: number }>()

  function entryFor(sliceName: string) {
    const existing = entries.get(sliceName)

    if (existing) return existing

    const created = { state: createInitial(), lastApplied: 0 }
    entries.set(sliceName, created)

    return created
  }

  function asStore(entry: { state: TState; lastApplied: number }): MemorySliceStore<TState> {
    return {
      write: entry.state,
      read: entry.state,
      lastAppliedOrder: () => Promise.resolve(entry.lastApplied),
      setLastAppliedOrder: (order) => {
        entry.lastApplied = order

        return Promise.resolve()
      },
    }
  }

  return {
    get: (sliceName) => asStore(entryFor(sliceName)),
    transaction: (sliceName, run) => run(asStore(entryFor(sliceName))),
  }
}
