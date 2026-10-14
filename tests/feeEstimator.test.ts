import { describe, expect, test } from 'bun:test'
import { estimateFeeHistory, estimateFromBlock } from '../src/widget/feeEstimator'

const hex = (value: bigint): string => `0x${value.toString(16)}`

const repeat = <T>(value: T, count: number): T[] => Array.from<T>({ length: count }).fill(value)

describe('estimateFeeHistory', () => {
  test('computes the documented formula from a full history tip', () => {
    // 5 blocks, tips 1..5, next base fee 110.
    // median([1,2,3,4,5]) = 3, latest tip = 5 -> T = 5
    // fee = max(ceil(110*11/10), 110 + 5) = max(121, 115) = 121
    const estimate = estimateFeeHistory({
      oldestBlock: '0x10',
      baseFeePerGas: ['0x64', '0x64', '0x64', '0x64', '0x64', '0x6e'],
      reward: [['0x1'], ['0x2'], ['0x3'], ['0x4'], ['0x5']],
      gasUsedRatio: [0.5, 0.5, 0.5, 0.5, 0.5],
    })

    expect(estimate).toEqual({
      feeWei: 121n,
      nextBaseFeeWei: 110n,
      blockNumber: 20n,
      historyBlocks: 5,
      provisional: false,
    })
  })

  test('handles 1 to 4 history blocks at startup', () => {
    for (const blocks of [1, 2, 3, 4]) {
      const estimate = estimateFeeHistory({
        oldestBlock: '0x20',
        baseFeePerGas: repeat('0x64', blocks + 1),
        reward: repeat(['0x5'], blocks),
        gasUsedRatio: repeat(0.5, blocks),
      })

      expect(estimate.historyBlocks).toBe(blocks)
      expect(estimate.blockNumber).toBe(0x20n + BigInt(blocks) - 1n)
      expect(estimate.provisional).toBe(false)
      // next base 100 -> fee = max(110, 105) = 110
      expect(estimate.feeWei).toBe(110n)
    }
  })

  test('uses an upward integer average for an even number of samples', () => {
    // tips [40, 30, 20, 10] -> median = ceil((20+30)/2) = 25, latest = 10 -> T = 25
    const estimate = estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: ['0x64', '0x64', '0x64', '0x64', '0x64'],
      reward: [[hex(40n)], [hex(30n)], [hex(20n)], [hex(10n)]],
      gasUsedRatio: [0.5, 0.5, 0.5, 0.5],
    })

    expect(estimate.nextBaseFeeWei).toBe(100n)
    expect(estimate.feeWei).toBe(125n) // 100 + 25 beats ceil(110)
    expect(estimate.historyBlocks).toBe(4)
    expect(estimate.provisional).toBe(false)
  })

  test('lets a recent tip spike dominate the median', () => {
    const estimate = estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: ['0x64', '0x64', '0x64', '0x64', '0x64', '0x64'],
      reward: [['0x1'], ['0x1'], ['0x1'], ['0x1'], [hex(1000n)]],
      gasUsedRatio: [0.5, 0.5, 0.5, 0.5, 0.9],
    })

    expect(estimate.feeWei).toBe(1100n) // 100 + spike(1000)
    expect(estimate.provisional).toBe(false)
  })

  test('keeps explicit zero tips for non-empty blocks', () => {
    const estimate = estimateFeeHistory({
      oldestBlock: '0x5',
      baseFeePerGas: ['0x64', '0x64', '0x64', '0x64'],
      reward: [['0x0'], ['0x0'], ['0x0']],
      gasUsedRatio: [0.1, 0.2, 0.3],
    })

    expect(estimate.provisional).toBe(false)
    expect(estimate.feeWei).toBe(110n)
    expect(estimate.historyBlocks).toBe(3)
  })

  test('treats explicit zero tips as legitimate when gasUsedRatio is absent', () => {
    const estimate = estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: repeat('0x64', 4),
      reward: [['0x0'], ['0x0'], ['0x0']],
    })

    expect(estimate.provisional).toBe(false)
    expect(estimate.feeWei).toBe(110n)
  })

  test('ignores rewards for gasUsedRatio-zero blocks even when a value is reported', () => {
    // Blocks 2..4 are empty, so their 100 wei rewards must be discarded.
    const estimate = estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: repeat('0x64', 6),
      reward: [['0x5'], ['0x5'], [hex(100n)], [hex(100n)], [hex(100n)]],
      gasUsedRatio: [0.5, 0.5, 0, 0, 0],
    })

    // samples = [5, 5] -> median 5, newest block tip = 0 -> T = 5
    expect(estimate.provisional).toBe(false)
    expect(estimate.feeWei).toBe(110n)
    expect(estimate.historyBlocks).toBe(5)
  })

  test('ignores empty reward entries for gasUsedRatio-zero blocks and samples the rest', () => {
    const estimate = estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: repeat('0x64', 6),
      reward: [[], [], [hex(50n)], [], []],
      gasUsedRatio: [0, 0, 0.5, 0, 0],
    })

    expect(estimate.provisional).toBe(false)
    expect(estimate.feeWei).toBe(150n) // max(110, 100 + 50)
  })

  test('floors T at the newest block tip, not the last usable tip', () => {
    // The newest block is empty, so its tip is zero: T = median([10,20,30,40]) = 25.
    const estimate = estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: repeat('0x64', 6),
      reward: [[hex(10n)], [hex(20n)], [hex(30n)], [hex(40n)], [hex(999n)]],
      gasUsedRatio: [0.5, 0.5, 0.5, 0.5, 0],
    })

    expect(estimate.provisional).toBe(false)
    expect(estimate.feeWei).toBe(125n) // 100 + 25, never 100 + 999
  })

  test('is provisional when every reward entry is empty', () => {
    const estimate = estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: ['0x64', '0x64', '0x64', '0x64', '0x64', '0x64'],
      reward: [[], [], [], [], []],
      gasUsedRatio: [0, 0, 0, 0, 0],
    })

    expect(estimate.provisional).toBe(true)
    expect(estimate.feeWei).toBe(110n)
    expect(estimate.blockNumber).toBe(4n)
  })

  test('is provisional when the reward array is absent but base and gas info are valid', () => {
    const estimate = estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: ['0x64', '0x64', '0x64'],
      gasUsedRatio: [0.5, 0.5],
    })

    expect(estimate).toEqual({
      feeWei: 110n,
      nextBaseFeeWei: 100n,
      blockNumber: 1n,
      historyBlocks: 2,
      provisional: true,
    })
  })

  test('allows a history with only the base fee array', () => {
    const estimate = estimateFeeHistory({
      oldestBlock: '0x2a',
      baseFeePerGas: ['0x64', '0x6e'],
    })

    expect(estimate.provisional).toBe(true)
    expect(estimate.nextBaseFeeWei).toBe(110n)
    expect(estimate.feeWei).toBe(121n)
    expect(estimate.blockNumber).toBe(42n)
    expect(estimate.historyBlocks).toBe(1)
  })

  test('caps the sample window at the five latest blocks', () => {
    const estimate = estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: repeat('0x64', 8),
      reward: [['0x1'], ['0x2'], ['0x3'], ['0x4'], ['0x5'], ['0x6'], ['0x7']],
      gasUsedRatio: repeat(0.5, 7),
    })

    // window is blocks 2..6 -> tips [3,4,5,6,7] -> median 5, latest 7 -> T = 7
    expect(estimate.historyBlocks).toBe(5)
    expect(estimate.blockNumber).toBe(6n)
    expect(estimate.feeWei).toBe(110n)
  })

  test('keeps full bigint precision beyond Number.MAX_SAFE_INTEGER', () => {
    const nextBase = 2n ** 80n
    const olderTip = 111111111111111111111n
    const newerTip = 222222222222222222222n
    const estimate = estimateFeeHistory({
      oldestBlock: '0xffffffff',
      baseFeePerGas: [hex(nextBase - 1n), hex(nextBase - 1n), hex(nextBase)],
      reward: [[hex(olderTip)], [hex(newerTip)]],
      gasUsedRatio: [0.9, 0.9],
    })

    // median = ceil((olderTip + newerTip) / 2); the latest tip is newerTip.
    // The +10% provisional floor still dwarfs the tip at this magnitude.
    const median = (olderTip + newerTip + 1n) / 2n
    expect(median).toBe(166666666666666666667n)
    expect(estimate.nextBaseFeeWei).toBe(nextBase)
    const buffered = (nextBase * 11n + 9n) / 10n
    const tipFloor = nextBase + newerTip
    expect(estimate.feeWei).toBe(buffered > tipFloor ? buffered : tipFloor)
    expect(estimate.feeWei).toBe(1329818401576092092176794n)
    expect(estimate.feeWei > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  test('throws on invalid or inconsistent inputs', () => {
    expect(() => estimateFeeHistory(null)).toThrow()
    expect(() => estimateFeeHistory([])).toThrow()
    expect(() => estimateFeeHistory({})).toThrow()
    expect(() => estimateFeeHistory({ oldestBlock: '0x0' })).toThrow()
    expect(() => estimateFeeHistory({ oldestBlock: '0x0', baseFeePerGas: ['0x64'] })).toThrow()
    expect(() => estimateFeeHistory({ oldestBlock: '0x0', baseFeePerGas: ['0x-1', '0x64'] })).toThrow()
    expect(() => estimateFeeHistory({ oldestBlock: '0x0', baseFeePerGas: ['zz', '0x64'] })).toThrow()
    expect(() => estimateFeeHistory({ oldestBlock: '7', baseFeePerGas: ['0x64', '0x64'] })).toThrow()
    expect(() => estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: ['0x64', '0x64', '0x64', '0x64'],
      reward: [['0x1'], ['0x2']],
    })).toThrow()
    expect(() => estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: ['0x64', '0x64', '0x64', '0x64'],
      gasUsedRatio: [0.5, 0.5],
    })).toThrow()
    expect(() => estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: ['0x64', '0x64', '0x64'],
      gasUsedRatio: [0.5, 1.5],
    })).toThrow()
    expect(() => estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: ['0x64', '0x64', '0x64'],
      reward: [['-0x1'], ['0x2']],
    })).toThrow()
    expect(() => estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: ['0x64', '0x64', '0x64'],
      reward: [['0x1', '0x2'], ['0x2']],
    })).toThrow()
    // empty reward for a block that actually used gas is inconsistent
    expect(() => estimateFeeHistory({
      oldestBlock: '0x0',
      baseFeePerGas: ['0x64', '0x64', '0x64'],
      reward: [[], ['0x2']],
      gasUsedRatio: [0.5, 0.5],
    })).toThrow()
  })
})

describe('estimateFromBlock', () => {
  const block = (baseFeeWei: bigint, gasUsed: bigint, gasLimit = 30_000_000n): Record<string, string> => ({
    number: '0x1',
    baseFeePerGas: hex(baseFeeWei),
    gasUsed: hex(gasUsed),
    gasLimit: hex(gasLimit),
  })

  test('matches the EIP-1559 increase formula', () => {
    // target = 15_000_000, delta = 15_000_000, change = 1000 * delta / target / 8 = 125
    const estimate = estimateFromBlock(block(1000n, 30_000_000n))

    expect(estimate.nextBaseFeeWei).toBe(1125n)
    expect(estimate.feeWei).toBe(1238n) // ceil(1125 * 1.1)
    expect(estimate.blockNumber).toBe(1n)
    expect(estimate.historyBlocks).toBe(0)
    expect(estimate.provisional).toBe(true)
  })

  test('matches the EIP-1559 decrease formula', () => {
    const estimate = estimateFromBlock(block(1000n, 0n))

    expect(estimate.nextBaseFeeWei).toBe(875n)
    expect(estimate.feeWei).toBe(963n) // ceil(875 * 1.1)
  })

  test('keeps the base fee when the block hits the target exactly', () => {
    const estimate = estimateFromBlock(block(1000n, 15_000_000n))

    expect(estimate.nextBaseFeeWei).toBe(1000n)
    expect(estimate.feeWei).toBe(1100n)
  })

  test('rounds a sub-wei increase up to one wei', () => {
    // change = floor(1 * 500_000 / 500_000 / 8) = 0 -> bumped to 1
    const estimate = estimateFromBlock(block(1n, 1_000_000n, 1_000_000n))

    expect(estimate.nextBaseFeeWei).toBe(2n)
    expect(estimate.feeWei).toBe(3n) // ceil(2 * 1.1)
  })

  test('throws instead of pretending the current base fee is the next one', () => {
    expect(() => estimateFromBlock(null)).toThrow()
    expect(() => estimateFromBlock({ number: '0x1' })).toThrow()
    expect(() => estimateFromBlock({ number: '0x1', baseFeePerGas: '0x64' })).toThrow()
    expect(() => estimateFromBlock({ number: '0x1', baseFeePerGas: '0x64', gasUsed: '0x0' })).toThrow()
    expect(() => estimateFromBlock({ baseFeePerGas: '0x64', gasUsed: '0x0', gasLimit: '0x1' })).toThrow()
    expect(() => estimateFromBlock({ number: '0x1', baseFeePerGas: '-0x64', gasUsed: '0x0', gasLimit: '0x1' })).toThrow()
    expect(() => estimateFromBlock(block(1000n, 30_000_001n))).toThrow()
  })
})
