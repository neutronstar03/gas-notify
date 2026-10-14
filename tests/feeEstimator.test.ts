import { describe, expect, test } from 'bun:test'
import { estimateFeeHistory, estimateFromBlock } from '../src/widget/feeEstimator'
import { formatWeiGwei } from '../src/widget/format'

const hex = (value: bigint): string => `0x${value.toString(16)}`
const history = (fees: bigint[], next: bigint, extra = {}) => ({ oldestBlock: '0xa', baseFeePerGas: [...fees, next].map(hex), ...extra })
const block = (current: bigint, used = 15_000_000n) => ({ number: '0xa', baseFeePerGas: hex(current), gasUsed: hex(used), gasLimit: hex(30_000_000n) })

describe('cost-oriented market reference', () => {
  test('ignores huge priority tips at startup and later', () => {
    const fees = [62000000n, 63000000n, 64000000n, 63000000n, 62000000n]
    const payload = history(fees, 61000000n, { reward: [['0xffffffffffff'], ['0xffffffffffff'], ['0xffffffffffff'], ['0xffffffffffff'], ['0xffffffffffff']] })
    const estimate = estimateFeeHistory(payload)
    expect(estimate.feeWei).toBe(68200000n)
    expect(formatWeiGwei(estimate.feeWei, true)).toBe('0.069')
    expect(estimateFeeHistory(history(fees, 61000000n)).feeWei).toBe(estimate.feeWei)
  })
  test('replays the original aggressive screenshot block', () => {
    const fees = ['0x3788ddb', '0x3b9677b', '0x35429f0', '0x3be9ca6', '0x428a7d7'].map(value => BigInt(value))
    const estimate = estimateFeeHistory(history(fees, BigInt('0x4021ced')))
    expect(estimate.feeWei < 77000000n).toBe(true)
    expect(estimate.feeWei > 67000000n).toBe(true)
    expect(estimate.feeWei < 217247997n).toBe(true)
  })
  test('supports one to five history blocks immediately', () => {
    for (let count = 1; count <= 5; count++) {
      const estimate = estimateFeeHistory(history(Array.from({ length: count }).fill(62000000n), 62000000n))
      expect(estimate.feeWei).toBe(68200000n)
      expect(estimate.historyBlocks).toBe(count)
      expect(estimate.blockNumber).toBe(10n + BigInt(count) - 1n)
      expect(estimate.provisional).toBe(false)
    }
  })
  test('tracks gradual growth without exceeding the current base plus ten percent', () => {
    const estimate = estimateFeeHistory(history([50000000n, 55000000n, 60000000n, 65000000n, 70000000n], 72000000n))
    expect(estimate.feeWei).toBe(72000001n)
  })
  test('falls promptly after a spike instead of holding its high historical value', () => {
    const estimate = estimateFeeHistory(history([200000000n, 190000000n, 150000000n, 80000000n, 62000000n], 61000000n))
    expect(estimate.feeWei).toBe(68200000n)
  })
  test('uses the exact next block base as a floor during a sudden rise', () => {
    const estimate = estimateFeeHistory(history([62000000n, 62000000n, 62000000n], 69750000n))
    expect(estimate.feeWei).toBe(69750001n)
    expect(formatWeiGwei(estimate.feeWei, true)).toBe('0.07')
  })
  test('uses only the last five blocks and retains bigint precision', () => {
    const current = 2n ** 80n
    const estimate = estimateFeeHistory(history([current * 100n, ...Array.from({ length: 5 }).fill(current)], current))
    expect(estimate.historyBlocks).toBe(5)
    expect(estimate.feeWei).toBe((current * 11n + 9n) / 10n)
  })
  test('rejects missing, invalid or impossible base fee predictions', () => {
    for (const payload of [null, [], {}, history([], 10n), history([100n], 200n), { oldestBlock: '0xa', baseFeePerGas: ['0x-1', '0x0'] }, { oldestBlock: 'x', baseFeePerGas: ['0x64', '0x64'] }]) {
      expect(() => estimateFeeHistory(payload)).toThrow()
    }
  })
})

describe('startup fallback', () => {
  test('uses current base plus ten percent under normal load', () => {
    const estimate = estimateFromBlock(block(62000000n))
    expect(estimate.feeWei).toBe(68200000n)
    expect(estimate.provisional).toBe(true)
  })
  test('does not stack another ten percent onto the full-block increase', () => {
    const estimate = estimateFromBlock(block(62000000n, 30000000n))
    expect(estimate.nextBaseFeeWei).toBe(69750000n)
    expect(estimate.feeWei).toBe(69750001n)
  })
  test('calculates the next base correctly for an empty block', () => {
    expect(estimateFromBlock(block(1000n, 0n)).nextBaseFeeWei).toBe(875n)
  })
  test('rejects malformed gas fields', () => {
    expect(() => estimateFromBlock({ number: '0xa', baseFeePerGas: '0x1' })).toThrow()
    expect(() => estimateFromBlock(block(1000n, 30000001n))).toThrow()
  })
})
