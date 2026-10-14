/** Cost-oriented market reference. Tips and reward percentiles do not affect the suggestion. */
export interface FeeEstimate {
  feeWei: bigint
  nextBaseFeeWei: bigint
  blockNumber: bigint
  historyBlocks: number
  provisional: boolean
}
const HEX_QUANTITY = /^0x[0-9a-f]+$/i
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value))
    throw new Error('Invalid hex quantity')
  return BigInt(value)
}
function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor
}
function referenceFee(market: bigint, current: bigint, next: bigint): bigint {
  const buffered = ceilDiv(market * 11n, 10n)
  const ceiling = ceilDiv(current * 11n, 10n)
  const affordable = buffered < ceiling ? buffered : ceiling
  // Cover the protocol's known next-block base fee, without stacking another 10% on top.
  return affordable > next ? affordable : next + 1n
}
export function estimateFeeHistory(payload: unknown): FeeEstimate {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Invalid fee history')
  const raw = payload as Record<string, unknown>
  if (!Array.isArray(raw.baseFeePerGas) || raw.baseFeePerGas.length < 2)
    throw new Error('Missing base fee history')
  const fees = raw.baseFeePerGas.map(quantity)
  const blocks = fees.length - 1
  const recent = fees.slice(Math.max(0, blocks - 5), blocks)
  // EMA with alpha=0.5: each newer block gets twice the weight of the previous aggregate.
  let market = recent[0]
  for (const fee of recent.slice(1)) market = ceilDiv(market + fee, 2n)
  const current = fees[blocks - 1]
  const next = fees[blocks]
  // Reject inconsistent predictions instead of producing a huge suggestion from bad upstream data.
  if (next > current + (current / 8n > 0n ? current / 8n : 1n))
    throw new Error('Impossible next base fee')
  return {
    feeWei: referenceFee(market, current, next),
    nextBaseFeeWei: next,
    blockNumber: quantity(raw.oldestBlock) + BigInt(blocks) - 1n,
    historyBlocks: recent.length,
    provisional: false,
  }
}
export function estimateFromBlock(block: unknown): FeeEstimate {
  if (!block || typeof block !== 'object' || Array.isArray(block))
    throw new Error('Invalid block')
  const raw = block as Record<string, unknown>
  const current = quantity(raw.baseFeePerGas)
  const used = quantity(raw.gasUsed)
  const limit = quantity(raw.gasLimit)
  const target = limit / 2n
  if (target <= 0n || used > limit)
    throw new Error('Invalid block gas utilization')
  const delta = used >= target ? used - target : target - used
  const change = current * delta / target / 8n
  const next = used > target ? current + (change > 0n ? change : 1n) : current - change
  return {
    feeWei: referenceFee(current, current, next),
    nextBaseFeeWei: next,
    blockNumber: quantity(raw.number),
    historyBlocks: 0,
    provisional: true,
  }
}
