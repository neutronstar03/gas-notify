export type Direction = 'below' | 'above' | 'both'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type ThresholdPosition = 'below' | 'above' | 'unknown'

export interface RpcEndpointInput {
  name?: string
  url: string
}

export interface ThresholdInput {
  name?: string
  gwei: number
  direction?: Direction
  hysteresisGwei?: number
  hysteresisPercent?: number
  cooldownSeconds?: number
  message?: string
}

export interface ThresholdRule {
  name: string
  gwei: number
  direction: Direction
  hysteresisGwei: number
  cooldownSeconds: number
  message?: string
}

export interface RpcEndpoint {
  name: string
  url: string
  transport: 'ws' | 'http'
}

export interface AppConfig {
  notificationTitle: string
  appId: string
  silentNotifications: boolean
  cooldownSeconds: number
  reconnectBaseDelayMs: number
  reconnectMaxDelayMs: number
  httpPollIntervalMs: number
  wsRetryWhilePollingMs: number
  rpcRequestTimeoutMs: number
  notifyOnStartupState: boolean
  notifyOnRecovery: boolean
  notifyOnRpcFailover: boolean
  logLevel: LogLevel
  logFilePath?: string
  stateFilePath: string
  configPath: string
  snoreToastPath?: string
  thresholds: ThresholdRule[]
  preferredRpcs: RpcEndpoint[]
  fallbackRpcs: RpcEndpoint[]
}

export interface FeeObservation {
  baseFeeGwei: number
  blockNumber: bigint
  blockNumberHex: string
  timestampMs: number
  providerName: string
  providerUrl: string
  mode: 'ws' | 'http'
}

export interface ThresholdState {
  position: ThresholdPosition
  lastNotificationAt?: number
}

export interface PersistedState {
  thresholds: Record<string, ThresholdState>
  lastSeenBlock?: string
  lastSeenBaseFeeGwei?: number
  lastUpdatedAt?: number
}

export interface NotificationEvent {
  threshold: ThresholdRule
  observation: FeeObservation
  crossedTo: Exclude<ThresholdPosition, 'unknown'>
  previousPosition: ThresholdPosition
  reason: string
}

export interface BlockData {
  number: string
  timestamp?: string
  baseFeePerGas?: string
}
