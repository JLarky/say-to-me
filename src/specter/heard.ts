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

const HeardIdsModel = t.Object({
  sessionId: t.String({ minLength: 1 }),
  messageId: t.String({ minLength: 1 }),
})

const HeardQueryInputModel = t.Object({
  sessionId: t.String({ minLength: 1 }),
})

const HeardReceiptModel = t.Object({
  sessionId: t.String({ minLength: 1 }),
  messageId: t.String({ minLength: 1 }),
  heardAt: t.String({ minLength: 1 }),
})

const HeardProjectionModel = t.Object({
  receipts: t.Array(HeardReceiptModel),
})

const HeardIds = typeboxStandardSchema(HeardIdsModel)

const HeardQueryInput = typeboxStandardSchema(HeardQueryInputModel)

export const messageHeard = createEventDefinition('message-heard', HeardIds)

export type HeardReceipt = UnwrapSchema<typeof HeardReceiptModel>

export type HeardProjection = UnwrapSchema<typeof HeardProjectionModel>

export type HeardQueryResult = {
  receipts: Array<{
    messageId: string
    heardAt: string
  }>
}

function emptyHeardProjection(): HeardProjection {
  return { receipts: [] }
}

function isHeardProjection(state: unknown): state is HeardProjection {
  return Value.Check(HeardProjectionModel, state)
}

const applyHeard = defineApplyHandlers([messageHeard], {
  'message-heard': async (event, state) => {
    if (!isHeardProjection(state)) {
      throw new Error('Heard slice store is corrupt.')
    }

    state.receipts.push({
      sessionId: event.payload.sessionId,
      messageId: event.payload.messageId,
      heardAt: event.recordedAt.toISOString(),
    })
  },
})

export function createHeardSpecterApp() {
  // Specter 0.2.1 app methods type to `never` when the store state is a named
  // projection (`CommandSlice<string, …>` no longer matches). Runtime store stays
  // typed; core sees an unknown-state adapter.
  const typedStores = createMemorySliceStore(emptyHeardProjection)

  const stores: SliceStoreAdapter = {
    get: (sliceName) => typedStores.get(sliceName),
    transaction: (sliceName, run) => typedStores.transaction(sliceName, (store) => run(store)),
  }

  const recordHeard = createCommandSlice(
    'recordHeard',
    'Records that the operator heard a spoken message.',
  )
    .schema(HeardIds)
    .store(stores)
    .apply(applyHeard)
    .handle(async (command, state) => {
      if (!isHeardProjection(state)) {
        throw new Error('Heard slice store is corrupt.')
      }

      const alreadyHeard = state.receipts.some(
        (receipt) =>
          receipt.sessionId === command.sessionId && receipt.messageId === command.messageId,
      )

      if (alreadyHeard) return []

      return [messageHeard.create(command)]
    })

  const heardQuery = createQuerySlice(
    'heardQuery',
    'Lists heard receipts for the given sessionId, in the order they were recorded.',
  )
    .schema(HeardQueryInput)
    .store(stores)
    .apply(applyHeard)
    .handle(async (query, state): Promise<HeardQueryResult> => {
      if (!isHeardProjection(state)) {
        throw new Error('Heard slice store is corrupt.')
      }

      const receipts: HeardQueryResult['receipts'] = []

      for (const receipt of state.receipts) {
        if (receipt.sessionId === query.sessionId) {
          receipts.push({
            messageId: receipt.messageId,
            heardAt: receipt.heardAt,
          })
        }
      }

      return { receipts }
    })

  return createSpecterApp({
    events: [messageHeard],
    eventLog: createMemoryEventLog(),
    slices: [recordHeard, heardQuery],
  })
}

export type HeardSpecterApp = ReturnType<typeof createHeardSpecterApp>
