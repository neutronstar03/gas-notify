import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const TRAILING_ZERO_GWEI_PATTERN = /(?:\.0+|(?<=\.\d)0+)$/

export function resolveFromRoot(...parts: string[]): string {
  return path.resolve(process.cwd(), ...parts)
}

export function hexToBigInt(value: string): bigint {
  return BigInt(value)
}

export function weiHexToGwei(value: string): number {
  const wei = hexToBigInt(value)
  return Number(wei) / 1e9
}

export function blockHexToBigInt(value: string): bigint {
  return BigInt(value)
}

export function formatGwei(value: number): string {
  return value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3).replace(TRAILING_ZERO_GWEI_PATTERN, '')
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function isWsUrl(url: string): boolean {
  return url.startsWith('ws://') || url.startsWith('wss://')
}

export function ensureError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

export function timestampLine(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`
}

export function relativeOrAbsolutePath(input: string): string {
  const expandedInput = expandHome(input)
  return path.isAbsolute(expandedInput) ? expandedInput : resolveFromRoot(expandedInput)
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
