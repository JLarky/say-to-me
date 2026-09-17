import { loadEnv } from '../config.ts'
import {
  createPairedClientsSpecterApp,
  type PairedClientsSpecterApp,
} from '../specter/paired-clients.ts'
import { issueRelayPairing, type IssuedPairing } from '../modules/relay/pairing.ts'

export type PairNewSuccess = {
  ok: true
  clientId: string
  serverId: string
  code: string
  relayUrl: string
}

export type PairNewFailure = {
  ok: false
  message: string
}

export type PairNewOutcome = PairNewSuccess | PairNewFailure

export type PairNewRequest = {
  env: NodeJS.ProcessEnv
  specter: PairedClientsSpecterApp
  issuePairing: (relayUrl: string) => Promise<IssuedPairing>
}

function failure(message: string): PairNewFailure {
  return { ok: false, message }
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

export function formatPairNewSuccess(result: PairNewSuccess): string {
  return `paired ${result.clientId}\ncode ${result.code}\nrelay ${result.relayUrl}\n`
}

export async function pairNew(request: PairNewRequest): Promise<PairNewOutcome> {
  let relayUrl: string

  try {
    relayUrl = loadEnv(request.env).RELAY_URL
  } catch (cause) {
    return failure(errorMessage(cause, 'RELAY_URL is missing or invalid'))
  }

  let issued: IssuedPairing

  try {
    issued = await request.issuePairing(relayUrl)
  } catch (cause) {
    return failure(errorMessage(cause, 'failed to issue a pairing code'))
  }

  if (issued.clientId.length === 0 || issued.code.length === 0) {
    return failure('pairing code is empty')
  }

  try {
    await request.specter.recordPair({ clientId: issued.clientId })
  } catch (cause) {
    return failure(errorMessage(cause, 'failed to record the pair'))
  }

  return {
    ok: true,
    clientId: issued.clientId,
    serverId: issued.serverId,
    code: issued.code,
    relayUrl: issued.relay.url,
  }
}

export function defaultPairNewRequest(env: NodeJS.ProcessEnv = process.env): PairNewRequest {
  return {
    env,
    specter: createPairedClientsSpecterApp(),
    issuePairing: issueRelayPairing,
  }
}
