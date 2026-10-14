/**
 * Pure bigint fee estimator.
 *
 * Two inputs are supported:
 * - an `eth_feeHistory` result ([count <= 5, 'latest', [60]]), where the tip is
 *   derived from the gas-weighted p60 reward of the most recent usable blocks.
 * - a single block, where the EIP-1559 next base fee is derived exactly from
 *   `baseFeePerGas`, `gasUsed` and `gasLimit`.
 *
 * No network access, no DOM. Invalid or inconsistent payloads throw so the
 * caller can fall back to a parent block instead of trusting bad data.
 */

export interface FeeEstimate {
  feeWei: bigint
  nextBaseFeeWei: bigint
  blockNumber: bigint
  historyBlocks: number
  provisional: boolean
}

const HEX_QUANTITY_PATTERN = /^0x[0-9a-f]+$/i
const MAX_HISTORY_BLOCKS = 5
const ELASTICITY_MULTIPLIER = 2n
const BASE_FEE_MAX_CHANGE_DENOMINATOR = 8n
const PROVISIONAL_BUFFER_NUMERATOR = 11n
const PROVISIONAL_BUFFER_DENOMINATOR = 10n

function parseHexQuantity(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !HEX_QUANTITY_PATTERN.test(value)) {
    throw new Error(`${label} must be a 0x-prefixed non-negative hex quantity`)
  }

  return BigInt(value)
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right
}

// Median with an upward integer average for even counts.
function medianInteger(values: readonly bigint[]): bigint {
  const sorted = [...values]
  sorted.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[middle]
  }

  return (sorted[middle - 1] + sorted[middle] + 1n) / 2n
}

function withProvisionalBuffer(nextBaseFeeWei: bigint): bigint {
  return ceilDiv(nextBaseFeeWei * PROVISIONAL_BUFFER_NUMERATOR, PROVISIONAL_BUFFER_DENOMINATOR)
}

function nextBaseFeeFromBlock(baseFeeWei: bigint, gasUsed: bigint, gasLimit: bigint): bigint {
  if (gasLimit <= 0n) {
    throw new Error('block.gasLimit must be greater than zero')
  }

  if (gasUsed > gasLimit) {
    throw new Error('block.gasUsed must not exceed block.gasLimit')
  }

  const target = gasLimit / ELASTICITY_MULTIPLIER
  if (target <= 0n) {
    throw new Error('block.gasLimit is too small to derive an EIP-1559 target')
  }

  const delta = gasUsed >= target ? gasUsed - target : target - gasUsed
  const change = baseFeeWei * delta / target / BASE_FEE_MAX_CHANGE_DENOMINATOR

  if (gasUsed > target) {
    return baseFeeWei + (change > 1n ? change : 1n)
  }

  if (gasUsed < target) {
    return baseFeeWei - change
  }

  return baseFeeWei
}

function parseGasUsedRatios(raw: unknown, blocks: number): number[] | null {
  if (raw === undefined || raw === null) {
    return null
  }

  if (!Array.isArray(raw) || raw.length !== blocks) {
    throw new Error('gasUsedRatio must align with baseFeePerGas (one entry per block)')
  }

  return raw.map((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 1) {
      throw new Error(`gasUsedRatio[${index}] must be a finite ratio between 0 and 1`)
    }

    return entry
  })
}

// Returns null when the reward array is absent; an empty inner array marks an
// empty block whose reward must be ignored (or rejected if the block is not empty).
function parseRewards(raw: unknown, blocks: number): bigint[][] | null {
  if (raw === undefined || raw === null) {
    return null
  }

  if (!Array.isArray(raw) || raw.length !== blocks) {
    throw new Error('reward must align with baseFeePerGas (one entry per block)')
  }

  return raw.map((entry, index) => {
    if (!Array.isArray(entry)) {
      throw new TypeError(`reward[${index}] must be an array`)
    }

    if (entry.length === 0) {
      return []
    }

    if (entry.length !== 1) {
      throw new Error(`reward[${index}] must contain exactly one percentile entry`)
    }

    return [parseHexQuantity(entry[0], `reward[${index}][0]`)]
  })
}

// Tip reported by the newest block, or zero when that block is empty or its
// reward is unknown.
function latestBlockTip(rewards: bigint[][] | null, ratios: number[] | null, blocks: number): bigint {
  if (!rewards) {
    return 0n
  }

  const index = blocks - 1
  if (ratios?.[index] === 0) {
    return 0n
  }

  const entry = rewards[index]
  return entry.length === 0 ? 0n : entry[0]
}

/**
 * Estimate a fee from an `eth_feeHistory` payload.
 *
 * `historyBlocks` is the size of the sample window actually used: the number of
 * blocks in the payload, capped at five. The estimate is provisional when no
 * usable reward sample was found (reward array absent, or every entry ignored).
 * Blocks whose `gasUsedRatio` is zero are treated as empty and their reward is
 * discarded, even when the node reports an explicit zero. An explicit zero tip
 * stays legitimate when `gasUsedRatio` is absent.
 */
export function estimateFeeHistory(payload: unknown): FeeEstimate {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('fee history payload must be an object')
  }

  const record = payload as Record<string, unknown>
  const baseFeesRaw = record.baseFeePerGas
  if (!Array.isArray(baseFeesRaw) || baseFeesRaw.length < 2) {
    throw new Error('baseFeePerGas must be an array of at least two hex quantities')
  }

  const baseFees = baseFeesRaw.map((entry, index) => parseHexQuantity(entry, `baseFeePerGas[${index}]`))
  const blocks = baseFees.length - 1
  const oldestBlock = parseHexQuantity(record.oldestBlock, 'oldestBlock')
  const gasUsedRatios = parseGasUsedRatios(record.gasUsedRatio, blocks)
  const rewards = parseRewards(record.reward, blocks)

  const windowStart = Math.max(0, blocks - MAX_HISTORY_BLOCKS)
  const samples: bigint[] = []
  if (rewards) {
    for (let index = windowStart; index < blocks; index++) {
      const ratio = gasUsedRatios ? gasUsedRatios[index] : undefined
      // A block that used no gas reports no priority fee; ignore whatever
      // reward the node returned for it, including an explicit zero.
      if (ratio === 0) {
        continue
      }

      const entry = rewards[index]
      if (entry.length === 0) {
        if (ratio !== undefined && ratio > 0) {
          throw new Error(`reward[${index}] is empty for a block with gasUsedRatio > 0`)
        }
        continue
      }

      samples.push(entry[0])
    }
  }

  // A full history of explicit zero tips is legitimate when gasUsedRatio is
  // absent: it yields T = 0 without being provisional.
  const provisional = samples.length === 0
  // T = max(median of the non-empty usable samples, newest block tip or zero).
  const tipWei = provisional ? 0n : maxBigInt(medianInteger(samples), latestBlockTip(rewards, gasUsedRatios, blocks))
  const nextBaseFeeWei = baseFees[blocks]

  return {
    feeWei: maxBigInt(withProvisionalBuffer(nextBaseFeeWei), nextBaseFeeWei + tipWei),
    nextBaseFeeWei,
    blockNumber: oldestBlock + BigInt(blocks) - 1n,
    historyBlocks: Math.min(blocks, MAX_HISTORY_BLOCKS),
    provisional,
  }
}

/**
 * Estimate a fee from a single block by computing the exact EIP-1559 next base
 * fee, then applying the provisional +10% buffer. Missing gas fields throw
 * instead of pretending the current base fee is the next one.
 */
export function estimateFromBlock(block: unknown): FeeEstimate {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    throw new TypeError('block must be an object')
  }

  const record = block as Record<string, unknown>
  if (record.baseFeePerGas === undefined || record.baseFeePerGas === null
    || record.gasUsed === undefined || record.gasUsed === null
    || record.gasLimit === undefined || record.gasLimit === null) {
    throw new Error('block is missing baseFeePerGas, gasUsed or gasLimit')
  }

  const baseFeeWei = parseHexQuantity(record.baseFeePerGas, 'block.baseFeePerGas')
  const gasUsed = parseHexQuantity(record.gasUsed, 'block.gasUsed')
  const gasLimit = parseHexQuantity(record.gasLimit, 'block.gasLimit')
  const blockNumber = parseHexQuantity(record.number, 'block.number')
  const nextBaseFeeWei = nextBaseFeeFromBlock(baseFeeWei, gasUsed, gasLimit)

  return {
    feeWei: withProvisionalBuffer(nextBaseFeeWei),
    nextBaseFeeWei,
    blockNumber,
    historyBlocks: 0,
    provisional: true,
  }
}
