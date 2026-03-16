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
  return new Date().toISOString()
}

export function relativeOrAbsolutePath(input: string): string {
  return path.isAbsolute(input) ? input : resolveFromRoot(input)
}
