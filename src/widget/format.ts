const WEI_PER_GWEI = 1_000_000_000n
const TRAILING_ZEROS = /0+$/

export function formatWeiGwei(value: bigint, roundUp = false): string {
  if (value < 0n)
    throw new Error('Fee must be non-negative')
  // Three decimals in gwei. Copy suggestions upward so display rounding cannot underbid.
  const unit = 1_000_000n
  if (!roundUp && value > 0n && value < unit)
    return '<0.001'
  const rounded = roundUp ? (value + unit - 1n) / unit * unit : (value + unit / 2n) / unit * unit
  const fraction = (rounded % WEI_PER_GWEI).toString().padStart(9, '0').replace(TRAILING_ZEROS, '')
  return `${rounded / WEI_PER_GWEI}${fraction ? `.${fraction}` : ''}`
}

export function formatGwei(value: number): string {
  return formatWeiGwei(BigInt(Math.round(value * 1e9)))
}

export function formatAge(timestampMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000))
  return seconds < 100 ? `${String(seconds).padStart(2, '0')}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`
}
