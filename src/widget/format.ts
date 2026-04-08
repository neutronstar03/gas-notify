const TRAILING_ZERO_GWEI_PATTERN = /(?:\.0+|(?<=\.\d)0+)$/

export function formatGwei(value: number): string {
  return value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3).replace(TRAILING_ZERO_GWEI_PATTERN, '')
}

export function formatAge(timestampMs: number): string {
  const diffSeconds = Math.max(0, Math.round((Date.now() - timestampMs) / 1000))
  return `${String(diffSeconds).padStart(2, '0')}s`
}
