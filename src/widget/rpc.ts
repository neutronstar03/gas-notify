import type { BlockResponse, Observation, Provider } from './types'
import { RPC_CONFIG } from './config'

const HEX_QUANTITY = /^0x[0-9a-f]+$/i

export async function requestHttp(url: string, method: string, params: unknown[], signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(RPC_CONFIG.timeoutMs)])
      : AbortSignal.timeout(RPC_CONFIG.timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  const payload = await response.json() as { error?: { message: string }, result?: unknown }
  if (payload.error) {
    throw new Error(payload.error.message)
  }

  return payload.result
}

export function toObservation(block: unknown, provider: Provider, mode: Observation['mode']): Observation {
  if (!block || typeof block !== 'object') {
    throw new Error('No block data')
  }

  const cast = block as BlockResponse
  if (!cast.baseFeePerGas || !cast.number) {
    throw new Error('Missing base fee')
  }

  if (![cast.baseFeePerGas, cast.number, cast.timestamp].every(value => typeof value === 'string' && HEX_QUANTITY.test(value))) {
    throw new Error('Invalid block quantities')
  }
  const timestampMs = Number(BigInt(cast.timestamp!)) * 1000
  if (!Number.isSafeInteger(timestampMs) || timestampMs > Date.now() + 15000) {
    throw new Error('Invalid block timestamp')
  }

  return {
    baseFeeWei: BigInt(cast.baseFeePerGas),
    baseFeeGwei: Number(BigInt(cast.baseFeePerGas)) / 1e9,
    blockNumber: BigInt(cast.number),
    timestampMs,
    receivedAtMs: Date.now(),
    providerName: provider.name,
    mode,
  }
}
