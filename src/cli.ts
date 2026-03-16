#!/usr/bin/env bun
import type { AppConfig, NotificationEvent } from './types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loadConfig } from './config'
import { Logger } from './logging/logger'
import { WindowsToastNotifier } from './notifications/windows-toast'
import { ensureAppDirectories, getAppPaths } from './paths'
import { runMonitor } from './run-monitor'

const PACKAGE_ROOT = path.resolve(import.meta.dir, '..')
const REPO_SCHEMA_PATH = path.join(PACKAGE_ROOT, 'config', 'config.schema.json')

async function main(): Promise<void> {
  const [command = 'run', ...args] = process.argv.slice(2)

  switch (command) {
    case 'init':
      await runInit(args)
      return
    case 'notify':
      await runNotify()
      return
    case 'help':
    case '--help':
    case '-h':
      printHelp()
      return
    default:
      if (command.startsWith('-')) {
        throw new Error(`Unknown flag: ${command}`)
      }

      await runDefault(command === 'run' ? [] : [command, ...args])
  }
}

async function runInit(args: string[]): Promise<void> {
  const force = args.includes('--force')
  const paths = getAppPaths()
  ensureAppDirectories(paths)

  writeSchema(paths.schemaPath)

  if (fs.existsSync(paths.configPath) && !force) {
    printPaths(paths)
    process.stdout.write(`Config already exists at ${paths.configPath}\nUse gas-notify init --force to overwrite it.\n`)
    return
  }

  fs.writeFileSync(paths.configPath, JSON.stringify(createDefaultConfig(), null, 2), 'utf8')
  printPaths(paths)
  process.stdout.write('Native Windows toast backend ready via toasted-notifier\n')
}

async function runNotify(): Promise<void> {
  const paths = getAppPaths()
  ensureAppDirectories(paths)
  const config = loadConfigOrDefaults(paths)

  const logger = new Logger('info')
  const notifier = new WindowsToastNotifier(config, logger.child('notify'))
  await notifier.notify(createDemoNotification())
  printPaths(paths)
}

async function runDefault(args: string[]): Promise<void> {
  if (args.length > 0) {
    throw new Error(`Unknown command: ${args[0]}`)
  }

  const paths = getAppPaths()
  ensureAppDirectories(paths)

  if (!fs.existsSync(paths.configPath)) {
    printPaths(paths)
    throw new Error(`Config is missing at ${paths.configPath}. Run gas-notify init first.`)
  }

  await runMonitor()
}

function createDefaultConfig(): Record<string, unknown> {
  return {
    $schema: './config.schema.json',
    thresholds: [
      {
        name: 'default',
        gwei: 0.06,
        direction: 'below',
        message: 'Transact on mainnet is now cheap',
      },
    ],
    preferredRpcs: [
      {
        url: 'wss://ethereum-rpc.publicnode.com',
      },
    ],
    fallbackRpcs: [
      {
        url: 'https://ethereum-rpc.publicnode.com',
      },
      {
        url: 'https://0xrpc.io/eth',
      },
    ],
  }
}

function createDemoNotification(): NotificationEvent {
  return {
    threshold: {
      name: 'demo',
      gwei: 0.06,
      direction: 'below',
      hysteresisGwei: 0.003,
      cooldownSeconds: 0,
      message: 'Gas Notify test notification',
    },
    observation: {
      baseFeeGwei: 0.05,
      blockNumber: 0n,
      blockNumberHex: '0x0',
      timestampMs: Date.now(),
      providerName: 'demo',
      providerUrl: 'local',
      mode: 'http',
    },
    crossedTo: 'below',
    previousPosition: 'above',
    reason: 'manual-test',
  }
}

function loadConfigOrDefaults(paths: ReturnType<typeof getAppPaths>): AppConfig {
  if (fs.existsSync(paths.configPath)) {
    return loadConfig()
  }

  return {
    notificationTitle: 'Gas Notify',
    appId: 'Gas Notify',
    notificationIconPath: undefined,
    silentNotifications: false,
    playNotificationSound: true,
    notificationSoundPath: undefined,
    cooldownSeconds: 180,
    reconnectBaseDelayMs: 2000,
    reconnectMaxDelayMs: 30000,
    httpPollIntervalMs: 12000,
    wsRetryWhilePollingMs: 60000,
    rpcRequestTimeoutMs: 12000,
    notifyOnStartupState: false,
    notifyOnRecovery: true,
    notifyOnRpcFailover: true,
    logLevel: 'info',
    logFilePath: paths.logPath,
    stateFilePath: paths.statePath,
    configPath: paths.configPath,
    thresholds: [],
    preferredRpcs: [],
    fallbackRpcs: [],
  }
}

function writeSchema(schemaPath: string): void {
  fs.copyFileSync(REPO_SCHEMA_PATH, schemaPath)
}

function printPaths(paths: ReturnType<typeof getAppPaths>): void {
  process.stdout.write([
    `Home: ${paths.homeDir}`,
    `Config: ${paths.configPath}`,
    `Schema: ${paths.schemaPath}`,
    `State: ${paths.statePath}`,
    `Log: ${paths.logPath}`,
  ].join('\n'))
  process.stdout.write('\n')
}

function printHelp(): void {
  process.stdout.write([
    'gas-notify',
    '',
    'Commands:',
    '  gas-notify           Run the monitor',
    '  gas-notify init      Create default config and schema in ~/.local/share/gas-notify',
    '  gas-notify notify    Send a demo notification',
  ].join('\n'))
  process.stdout.write('\n')
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
