import { Value } from '@sinclair/typebox/value'
import {
  createCommandSlice,
  createEventDefinition,
  createQuerySlice,
  createSpecterApp,
  defineApplyHandlers,
  type SliceStoreAdapter,
} from '@specter-ts/core'
import { t, type UnwrapSchema } from 'elysia'
import { createMemoryEventLog, createMemorySliceStore } from './memory.ts'
import { typeboxStandardSchema } from './typebox-standard.ts'

const PairClientModel = t.Object({
  clientId: t.String({ minLength: 1 }),
})

const PairedClientsQueryInputModel = t.Object({})

const PairedClientModel = t.Object({
  clientId: t.String({ minLength: 1 }),
  pairedAt: t.String({ minLength: 1 }),
})

const PairedClientsProjectionModel = t.Object({
  clients: t.Array(PairedClientModel),
})

const PairClient = typeboxStandardSchema(PairClientModel)

const PairedClientsQueryInput = typeboxStandardSchema(PairedClientsQueryInputModel)

export const clientPaired = createEventDefinition('client-paired', PairClient)

export type PairedClient = UnwrapSchema<typeof PairedClientModel>

export type PairedClientsProjection = UnwrapSchema<typeof PairedClientsProjectionModel>

export type PairedClientsQueryResult = {
  clients: Array<{
    clientId: string
    pairedAt: string
  }>
}

function emptyPairedClientsProjection(): PairedClientsProjection {
  return { clients: [] }
}

function isPairedClientsProjection(state: unknown): state is PairedClientsProjection {
  return Value.Check(PairedClientsProjectionModel, state)
}

const applyPairedClients = defineApplyHandlers([clientPaired], {
  'client-paired': async (event, state) => {
    if (!isPairedClientsProjection(state)) {
      throw new Error('Paired-clients slice store is corrupt.')
    }

    state.clients.push({
      clientId: event.payload.clientId,
      pairedAt: event.recordedAt.toISOString(),
    })
  },
})

export function createPairedClientsSpecterApp() {
  // Specter 0.2.1 app methods type to `never` when the store state is a named
  // projection (`CommandSlice<string, …>` no longer matches). Runtime store stays
  // typed; core sees an unknown-state adapter.
  const typedStores = createMemorySliceStore(emptyPairedClientsProjection)

  const stores: SliceStoreAdapter = {
    get: (sliceName) => typedStores.get(sliceName),
    transaction: (sliceName, run) => typedStores.transaction(sliceName, (store) => run(store)),
  }

  const recordPair = createCommandSlice('recordPair', 'Records that a pair succeeded.')
    .schema(PairClient)
    .store(stores)
    .apply(applyPairedClients)
    .handle(async (command, state) => {
      if (!isPairedClientsProjection(state)) {
        throw new Error('Paired-clients slice store is corrupt.')
      }

      const alreadyPaired = state.clients.some((client) => client.clientId === command.clientId)

      if (alreadyPaired) return []

      return [clientPaired.create(command)]
    })

  const pairedClientsQuery = createQuerySlice(
    'pairedClientsQuery',
    'Lists paired clients, in the order they were recorded.',
  )
    .schema(PairedClientsQueryInput)
    .store(stores)
    .apply(applyPairedClients)
    .handle(async (_query, state): Promise<PairedClientsQueryResult> => {
      if (!isPairedClientsProjection(state)) {
        throw new Error('Paired-clients slice store is corrupt.')
      }

      return {
        clients: state.clients.map((client) => ({
          clientId: client.clientId,
          pairedAt: client.pairedAt,
        })),
      }
    })

  return createSpecterApp({
    events: [clientPaired],
    eventLog: createMemoryEventLog(),
    slices: [recordPair, pairedClientsQuery],
  })
}

export type PairedClientsSpecterApp = ReturnType<typeof createPairedClientsSpecterApp>
