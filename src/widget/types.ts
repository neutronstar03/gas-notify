export interface Provider {
  name: string
  url: string
}

export interface Observation {
  baseFeeGwei: number
  blockNumber: bigint
  timestampMs: number
  providerName: string
  mode: 'ws' | 'http'
}

export type ConnectionMode = 'ws' | 'http' | 'down'

export interface BlockResponse {
  baseFeePerGas?: string
  number?: string
  timestamp?: string
}
