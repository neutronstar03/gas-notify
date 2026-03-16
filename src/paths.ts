import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export interface AppPaths {
  homeDir: string
  binDir: string
  configPath: string
  schemaPath: string
  statePath: string
  logPath: string
}

export function getAppPaths(): AppPaths {
  const homeDir = process.env.GAS_NOTIFY_HOME
    ? expandHome(process.env.GAS_NOTIFY_HOME)
    : path.join(os.homedir(), '.local', 'share', 'gas-notify')

  return {
    homeDir,
    binDir: path.join(homeDir, 'bin'),
    configPath: path.join(homeDir, 'config.json'),
    schemaPath: path.join(homeDir, 'config.schema.json'),
    statePath: path.join(homeDir, 'state.json'),
    logPath: path.join(homeDir, 'logs', 'gas-notify.log'),
  }
}

export function ensureAppDirectories(paths: AppPaths): void {
  fs.mkdirSync(paths.homeDir, { recursive: true })
  fs.mkdirSync(paths.binDir, { recursive: true })
  fs.mkdirSync(path.dirname(paths.logPath), { recursive: true })
}

function expandHome(input: string): string {
  if (input === '~') {
    return os.homedir()
  }

  if (input.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), input.slice(2))
  }

  return input
}
