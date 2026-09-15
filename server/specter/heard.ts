import {
  createCommandSlice,
  createEventDefinition,
  createQuerySlice,
  createSpecterApp,
  defineApplyHandlers,
  type SliceStoreAdapter,
} from "@specter-ts/core";
import { Schema } from "effect";
import { createMemoryEventLog, createMemorySliceStore } from "./memory.ts";

const HeardIds = Schema.standardSchemaV1(
  Schema.Struct({
    sessionId: Schema.NonEmptyString,
    messageId: Schema.NonEmptyString,
  }),
);

const HeardQueryInput = Schema.standardSchemaV1(
  Schema.Struct({
    sessionId: Schema.NonEmptyString,
  }),
);

export const messageHeard = createEventDefinition("message-heard", HeardIds);

export type HeardReceipt = {
  sessionId: string;
  messageId: string;
  heardAt: string;
};

export type HeardProjection = {
  receipts: HeardReceipt[];
};

export type HeardQueryResult = {
  receipts: Array<{
    messageId: string;
    heardAt: string;
  }>;
};

function emptyHeardProjection(): HeardProjection {
  return { receipts: [] };
}

function isHeardProjection(state: unknown): state is HeardProjection {
  return Boolean(
    state && typeof state === "object" && "receipts" in state && Array.isArray(state.receipts),
  );
}

function heardProjection(state: unknown): HeardProjection {
  if (!isHeardProjection(state)) {
    throw new Error("Heard slice store is corrupt.");
  }
  return state;
}

const applyHeard = defineApplyHandlers([messageHeard], {
  "message-heard": async (event, state) => {
    heardProjection(state).receipts.push({
      sessionId: event.payload.sessionId,
      messageId: event.payload.messageId,
      heardAt: event.recordedAt.toISOString(),
    });
  },
});

export function createHeardSpecterApp() {
  // Specter 0.2.1 app methods type to `never` when the store state is a named
  // projection (`CommandSlice<string, …>` no longer matches). Runtime store stays
  // typed; core sees an unknown-state adapter.
  const typedStores = createMemorySliceStore(emptyHeardProjection);
  const stores: SliceStoreAdapter = {
    get: (sliceName) => typedStores.get(sliceName),
    transaction: (sliceName, run) => typedStores.transaction(sliceName, (store) => run(store)),
  };

  const recordHeard = createCommandSlice(
    "recordHeard",
    "Records that the operator heard a spoken session message.",
  )
    .schema(HeardIds)
    .store(stores)
    .apply(applyHeard)
    .handle(async (command, state) => {
      const alreadyHeard = heardProjection(state).receipts.some(
        (receipt) =>
          receipt.sessionId === command.sessionId && receipt.messageId === command.messageId,
      );
      if (alreadyHeard) return [];
      return [messageHeard.create(command)];
    });

  const heardQuery = createQuerySlice(
    "heardQuery",
    "Lists heard receipts for a session, in the order they were recorded.",
  )
    .schema(HeardQueryInput)
    .store(stores)
    .apply(applyHeard)
    .handle(
      async (query, state): Promise<HeardQueryResult> => ({
        receipts: heardProjection(state)
          .receipts.filter((receipt) => receipt.sessionId === query.sessionId)
          .map((receipt) => ({
            messageId: receipt.messageId,
            heardAt: receipt.heardAt,
          })),
      }),
    );

  return createSpecterApp({
    events: [messageHeard],
    eventLog: createMemoryEventLog(),
    slices: [recordHeard, heardQuery],
  });
}

export type HeardSpecterApp = ReturnType<typeof createHeardSpecterApp>;
