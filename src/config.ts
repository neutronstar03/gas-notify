import type { Logger } from './logging/logger'
import type { AppConfig, Direction, RpcEndpoint, RpcEndpointInput, ThresholdInput, ThresholdRule } from './types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getAppPaths } from './paths'
import { isWsUrl, relativeOrAbsolutePath } from './utils'

type RawConfig = Partial<Omit<AppConfig, 'configPath' | 'thresholds' | 'preferredRpcs' | 'fallbackRpcs'>> & {
  thresholdGwei?: number
  direction?: Direction
  hysteresisGwei?: number
  hysteresisPercent?: number
  thresholds?: ThresholdInput[]
  preferredRpcs?: RpcEndpointInput[]
  fallbackRpcs?: RpcEndpointInput[]
}

const DEFAULT_CONFIG_PATH = getAppPaths().configPath
const DEFAULT_NOTIFICATION_ICON_PATH = path.resolve(import.meta.dir, '..', 'assets', 'ethereum-icon.png')
const DEFAULT_NOTIFICATION_SOUND_PATH = path.resolve(import.meta.dir, '..', 'assets', 'notification-ping.mp3')

const DEFAULTS = {
  notificationTitle: 'Gas Notify',
  appId: 'Gas Notify',
  notificationIconPath: DEFAULT_NOTIFICATION_ICON_PATH,
  silentNotifications: true,
  playNotificationSound: true,
  notificationSoundPath: DEFAULT_NOTIFICATION_SOUND_PATH,
  cooldownSeconds: 180,
  reconnectBaseDelayMs: 2000,
  reconnectMaxDelayMs: 30000,
  httpPollIntervalMs: 12000,
  wsRetryWhilePollingMs: 60000,
  rpcRequestTimeoutMs: 12000,
  notifyOnStartupState: false,
  notifyOnRecovery: true,
  notifyOnRpcFailover: true,
  hysteresisPercent: 5,
  logLevel: 'info' as const,
  stateFilePath: getAppPaths().statePath,
  logFilePath: getAppPaths().logPath,
}

const ENV_NUMBER_KEYS = {
  GAS_NOTIFY_THRESHOLD_GWEI: 'thresholdGwei',
  GAS_NOTIFY_COOLDOWN_SECONDS: 'cooldownSeconds',
  GAS_NOTIFY_RECONNECT_BASE_DELAY_MS: 'reconnectBaseDelayMs',
  GAS_NOTIFY_RECONNECT_MAX_DELAY_MS: 'reconnectMaxDelayMs',
  GAS_NOTIFY_HTTP_POLL_INTERVAL_MS: 'httpPollIntervalMs',
  GAS_NOTIFY_WS_RETRY_WHILE_POLLING_MS: 'wsRetryWhilePollingMs',
  GAS_NOTIFY_RPC_TIMEOUT_MS: 'rpcRequestTimeoutMs',
} as const satisfies Record<string, keyof RawConfig>

const ENV_STRING_KEYS = {
  GAS_NOTIFY_DIRECTION: 'direction',
  GAS_NOTIFY_NOTIFICATION_TITLE: 'notificationTitle',
  GAS_NOTIFY_APP_ID: 'appId',
  GAS_NOTIFY_NOTIFICATION_ICON_PATH: 'notificationIconPath',
  GAS_NOTIFY_LOG_LEVEL: 'logLevel',
  GAS_NOTIFY_LOG_FILE: 'logFilePath',
  GAS_NOTIFY_NOTIFICATION_SOUND_PATH: 'notificationSoundPath',
  GAS_NOTIFY_STATE_FILE: 'stateFilePath',
} as const satisfies Record<string, keyof RawConfig>

const ENV_BOOLEAN_KEYS = {
  GAS_NOTIFY_SILENT: 'silentNotifications',
  GAS_NOTIFY_PLAY_NOTIFICATION_SOUND: 'playNotificationSound',
  GAS_NOTIFY_NOTIFY_ON_STARTUP: 'notifyOnStartupState',
  GAS_NOTIFY_NOTIFY_ON_RECOVERY: 'notifyOnRecovery',
  GAS_NOTIFY_NOTIFY_ON_RPC_FAILOVER: 'notifyOnRpcFailover',
} as const satisfies Record<string, keyof RawConfig>

export function loadConfig(): AppConfig {
  const configPath = process.env.GAS_NOTIFY_CONFIG
    ? relativeOrAbsolutePath(process.env.GAS_NOTIFY_CONFIG)
    : DEFAULT_CONFIG_PATH

  const fileConfig = fs.existsSync(configPath)
    ? (JSON.parse(fs.readFileSync(configPath, 'utf8')) as RawConfig)
    : {}

  const merged = applyEnvOverrides({ ...DEFAULTS, ...fileConfig })
  const thresholds = normalizeThresholds(merged)
  const preferredRpcs = normalizeRpcs(merged.preferredRpcs ?? [], 'ws')
  const fallbackRpcs = normalizeRpcs(merged.fallbackRpcs ?? [], 'http')

  if (thresholds.length === 0) {
    throw new Error('At least one threshold must be configured via thresholds[] or thresholdGwei.')
  }

  if (preferredRpcs.length === 0 && fallbackRpcs.length === 0) {
    throw new Error('At least one RPC endpoint must be configured.')
  }

  return {
    notificationTitle: merged.notificationTitle ?? DEFAULTS.notificationTitle,
    appId: merged.appId ?? DEFAULTS.appId,
    notificationIconPath: merged.notificationIconPath ? relativeOrAbsolutePath(merged.notificationIconPath) : DEFAULTS.notificationIconPath,
    silentNotifications: merged.silentNotifications ?? DEFAULTS.silentNotifications,
    playNotificationSound: merged.playNotificationSound ?? DEFAULTS.playNotificationSound,
    notificationSoundPath: merged.notificationSoundPath ? relativeOrAbsolutePath(merged.notificationSoundPath) : DEFAULTS.notificationSoundPath,
    cooldownSeconds: merged.cooldownSeconds ?? DEFAULTS.cooldownSeconds,
    reconnectBaseDelayMs: merged.reconnectBaseDelayMs ?? DEFAULTS.reconnectBaseDelayMs,
    reconnectMaxDelayMs: merged.reconnectMaxDelayMs ?? DEFAULTS.reconnectMaxDelayMs,
    httpPollIntervalMs: merged.httpPollIntervalMs ?? DEFAULTS.httpPollIntervalMs,
    wsRetryWhilePollingMs: merged.wsRetryWhilePollingMs ?? DEFAULTS.wsRetryWhilePollingMs,
    rpcRequestTimeoutMs: merged.rpcRequestTimeoutMs ?? DEFAULTS.rpcRequestTimeoutMs,
    notifyOnStartupState: merged.notifyOnStartupState ?? DEFAULTS.notifyOnStartupState,
    notifyOnRecovery: merged.notifyOnRecovery ?? DEFAULTS.notifyOnRecovery,
    notifyOnRpcFailover: merged.notifyOnRpcFailover ?? DEFAULTS.notifyOnRpcFailover,
    logLevel: merged.logLevel ?? DEFAULTS.logLevel,
    configPath,
    logFilePath: merged.logFilePath ? relativeOrAbsolutePath(merged.logFilePath) : DEFAULTS.logFilePath,
    stateFilePath: relativeOrAbsolutePath(merged.stateFilePath ?? DEFAULTS.stateFilePath),
    thresholds,
    preferredRpcs,
    fallbackRpcs,
  }
}

export function logConfigSummary(logger: Logger, config: AppConfig): void {
  logger.info(
    `Configuration found, ${config.thresholds.length} ${pluralize(config.thresholds.length, 'threshold')} registered`,
  )
  logger.debug('Resolved configuration', {
    configPath: config.configPath,
    notificationTitle: config.notificationTitle,
    appId: config.appId,
    notificationIconPath: config.notificationIconPath,
    silentNotifications: config.silentNotifications,
    playNotificationSound: config.playNotificationSound,
    notificationSoundPath: config.notificationSoundPath,
    cooldownSeconds: config.cooldownSeconds,
    reconnectBaseDelayMs: config.reconnectBaseDelayMs,
    reconnectMaxDelayMs: config.reconnectMaxDelayMs,
    httpPollIntervalMs: config.httpPollIntervalMs,
    wsRetryWhilePollingMs: config.wsRetryWhilePollingMs,
    rpcRequestTimeoutMs: config.rpcRequestTimeoutMs,
    notifyOnStartupState: config.notifyOnStartupState,
    notifyOnRecovery: config.notifyOnRecovery,
    notifyOnRpcFailover: config.notifyOnRpcFailover,
    thresholdNames: config.thresholds.map(threshold => threshold.name),
    preferredRpcs: config.preferredRpcs.map(rpc => rpc.name),
    fallbackRpcs: config.fallbackRpcs.map(rpc => rpc.name),
  })
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`
}

function applyEnvOverrides(config: RawConfig): RawConfig {
  const merged: RawConfig = { ...config }

  for (const [envKey, configKey] of Object.entries(ENV_NUMBER_KEYS)) {
    const value = process.env[envKey]
    if (value) {
      merged[configKey] = Number(value) as never
    }
  }

  for (const [envKey, configKey] of Object.entries(ENV_STRING_KEYS)) {
    const value = process.env[envKey]
    if (value) {
      merged[configKey] = value as never
    }
  }

  for (const [envKey, configKey] of Object.entries(ENV_BOOLEAN_KEYS)) {
    const value = process.env[envKey]
    if (value) {
      merged[configKey] = (value === 'true') as never
    }
  }

  return merged
}

function normalizeThresholds(config: RawConfig): ThresholdRule[] {
  const inputs = config.thresholds?.length
    ? config.thresholds
    : config.thresholdGwei !== undefined
      ? [{ gwei: config.thresholdGwei, name: 'default' }]
      : []

  return inputs.map((threshold, index) => ({
    name: threshold.name?.trim() || `threshold-${index + 1}`,
    gwei: threshold.gwei,
    direction: threshold.direction ?? config.direction ?? 'below',
    hysteresisGwei: resolveHysteresisGwei(threshold, config),
    cooldownSeconds: threshold.cooldownSeconds ?? config.cooldownSeconds ?? DEFAULTS.cooldownSeconds,
    message: threshold.message,
  }))
}

function resolveHysteresisGwei(threshold: ThresholdInput, config: RawConfig): number {
  if (threshold.hysteresisGwei !== undefined) {
    return threshold.hysteresisGwei
  }

  if (config.hysteresisGwei !== undefined) {
    return config.hysteresisGwei
  }

  const hysteresisPercent = threshold.hysteresisPercent ?? config.hysteresisPercent ?? DEFAULTS.hysteresisPercent
  return threshold.gwei * (hysteresisPercent / 100)
}

function normalizeRpcs(inputs: RpcEndpointInput[], transport: RpcEndpoint['transport']): RpcEndpoint[] {
  return inputs
    .filter(rpc => Boolean(rpc?.url))
    .filter(rpc => (transport === 'ws' ? isWsUrl(rpc.url) : !isWsUrl(rpc.url)))
    .map((rpc, index) => ({
      name: rpc.name?.trim() || `${transport}-${index + 1}`,
      url: rpc.url,
      transport,
    }))
}
