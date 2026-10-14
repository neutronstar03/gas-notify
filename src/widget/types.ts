export interface Provider {
  name: string
  url: string
}

export interface Observation {
  baseFeeWei: bigint
  baseFeeGwei: number
  blockNumber: bigint
  timestampMs: number
  receivedAtMs: number
  providerName: string
  mode: 'ws' | 'http'
}

export type ConnectionMode = 'ws' | 'http' | 'down'

export interface BlockResponse {
  baseFeePerGas?: string
  number?: string
  timestamp?: string
  gasUsed?: string
  gasLimit?: string
}
