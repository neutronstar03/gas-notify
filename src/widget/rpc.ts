import type { BlockResponse, Observation, Provider } from './types'
import { RPC_CONFIG } from './config'

export async function requestHttp(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(RPC_CONFIG.timeoutMs),
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

  return {
    baseFeeGwei: Number(BigInt(cast.baseFeePerGas)) / 1e9,
    blockNumber: BigInt(cast.number),
    timestampMs: cast.timestamp ? Number(BigInt(cast.timestamp)) * 1000 : Date.now(),
    providerName: provider.name,
    mode,
  }
}
