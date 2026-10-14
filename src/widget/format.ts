const WEI_PER_GWEI = 1_000_000_000n
const TRAILING_ZEROS = /0+$/

export function formatWeiGwei(value: bigint, roundUp = false): string {
  if (value < 0n)
    throw new Error('Fee must be non-negative')
  // Six decimals normally, retain individual wei for tiny fees. Never copy zero for a positive fee.
  const unit = value > 0n && value < 1000n ? 1n : 1000n
  const rounded = roundUp ? (value + unit - 1n) / unit * unit : value / unit * unit
  const fraction = (rounded % WEI_PER_GWEI).toString().padStart(9, '0').replace(TRAILING_ZEROS, '')
  return `${rounded / WEI_PER_GWEI}${fraction ? `.${fraction}` : ''}`
}

export function formatGwei(value: number): string {
  return formatWeiGwei(BigInt(Math.round(value * 1e9)))
}

export function formatAge(timestampMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000))
  return seconds < 60 ? `${String(seconds).padStart(2, '0')}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
