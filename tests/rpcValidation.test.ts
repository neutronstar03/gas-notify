import type { CandidateResult } from '../scripts/validate-rpcs'
import process from 'node:process'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  evaluateBlock,
  evaluateFeeHistory,
  groupResults,
  loadChainlistCandidates,
  main,
  parseArgs,
} from '../scripts/validate-rpcs'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function hex(value: number): string {
  return `0x${value.toString(16)}`
}

function jsonRpcStub(handler: (method: string, params: unknown[]) => unknown): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number, method: string, params: unknown[] }
    try {
      return Response.json({ jsonrpc: '2.0', id: body.id, result: handler(body.method, body.params) })
    }
    catch (error) {
      return Response.json({ jsonrpc: '2.0', id: body.id, error: { message: (error as Error).message } })
    }
  }) as unknown as typeof fetch
}

function feeHistoryFixture(oldestBlock: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    oldestBlock: hex(oldestBlock),
    baseFeePerGas: ['0x1', '0x1', '0x1', '0x1', '0x1', '0x2'],
    gasUsedRatio: [0.5, 0.5, 0.5, 0.5, 0.5],
    reward: [['0x0'], ['0x0'], ['0x0'], ['0x0'], ['0x0']],
    ...overrides,
  }
}

describe('chainlist discovery normalization', () => {
  test('normalizes string and object entries, filters other chains, skips placeholders', async () => {
    globalThis.fetch = (async () => Response.json([
      { chainId: 137, rpc: ['https://polygon.example/eth'] },
      {
        chainId: 1,
        rpc: [
          'https://a.example/eth',
          { url: 'wss://b.example/eth', tracking: 'none' },
          { url: 'https://x.example/eth?api_key=demo' },
          'https://a.example/eth',
          { url: 'https://y.example/eth?api_key=real123key' },
          'https://z.example/$' + '{API_KEY}',
          42,
        ],
      },
    ])) as unknown as typeof fetch

    const discovery = await loadChainlistCandidates()
    expect(discovery.source).toBe('chainlist')
    expect(discovery.rawCount).toBe(7)
    expect(discovery.candidates).toEqual([
      'https://a.example/eth',
      'wss://b.example/eth',
      'https://y.example/eth?api_key=real123key',
    ])
  })
})

describe('block freshness', () => {
  test('accepts a fresh block and flags an old one', () => {
    const now = Date.now()
    const fresh = evaluateBlock({ number: '0x15f9000', baseFeePerGas: '0x3b9aca00', timestamp: hex(Math.floor(now / 1000) - 5) }, now, 60000)
    expect(fresh.ok).toBe(true)
    if (fresh.ok) {
      expect(fresh.block.fresh).toBe(true)
      expect(fresh.block.baseFeeGwei).toBe(1)
    }

    const stale = evaluateBlock({ number: '0x15f9000', baseFeePerGas: '0x3b9aca00', timestamp: hex(Math.floor(now / 1000) - 120) }, now, 60000)
    expect(stale.ok && stale.block.fresh).toBe(false)
  })

  test('rejects a block without a positive base fee', () => {
    const block = evaluateBlock({ number: '0x1', baseFeePerGas: '0x0', timestamp: hex(1) }, Date.now(), 60000)
    expect(block.ok).toBe(false)
  })
})

describe('fee history validation', () => {
  const oldestBlock = 23000000
  const newestBlock = oldestBlock + 4

  test('accepts all-zero tips because usability is shape, not positivity', () => {
    const history = evaluateFeeHistory(feeHistoryFixture(oldestBlock), newestBlock)
    expect(history.ok).toBe(true)
    if (history.ok) {
      expect(history.history.blockCount).toBe(5)
      expect(history.history.alignmentDelta).toBe(0)
      expect(history.history.usableRewards).toBe(true)
      expect(history.history.rewardsMinGwei).toBe(0)
      expect(history.history.nextBaseFeeGwei).toBeCloseTo(2 / 1e9, 12)
    }
  })

  test('rejects missing reward rows and wrong percentile counts', () => {
    expect(evaluateFeeHistory(feeHistoryFixture(oldestBlock, { reward: undefined }), newestBlock).ok).toBe(false)
    const wrongCount = evaluateFeeHistory(feeHistoryFixture(oldestBlock, { reward: [['0x1', '0x2'], ['0x1'], ['0x1'], ['0x1'], ['0x1']] }), newestBlock)
    expect(wrongCount.ok).toBe(false)
  })

  test('rejects a non-finite or out-of-range gasUsedRatio', () => {
    const nonFinite = evaluateFeeHistory(feeHistoryFixture(oldestBlock, { gasUsedRatio: [Number.NaN, 0.5, 0.5, 0.5, 0.5] }), newestBlock)
    expect(nonFinite.ok).toBe(false)
    const outOfRange = evaluateFeeHistory(feeHistoryFixture(oldestBlock, { gasUsedRatio: [0.5, 0.5, 0.5, 0.5, 1.4] }), newestBlock)
    expect(outOfRange.ok).toBe(false)
  })

  test('rejects fee history that is not aligned with the latest block', () => {
    expect(evaluateFeeHistory(feeHistoryFixture(oldestBlock), newestBlock + 10).ok).toBe(false)
  })
})

describe('grouping', () => {
  test('buckets every result into one of the three groups', () => {
    const base = { name: 'n', url: 'u', transport: 'http' as const, details: 'd', suitable: false, latencyMs: { totalMs: 1 } }
    const results: CandidateResult[] = [
      { ...base, category: 'ws_confirmed' },
      { ...base, category: 'http_confirmed' },
      { ...base, category: 'rejected' },
      { ...base, category: 'rejected' },
    ]
    const grouped = groupResults(results)
    expect(grouped.ws_confirmed).toHaveLength(1)
    expect(grouped.http_confirmed).toHaveLength(1)
    expect(grouped.rejected).toHaveLength(2)
  })
})

describe('cli options', () => {
  test('treats the legacy flag as skipping discovery and parses bounds', () => {
    expect(parseArgs(['--skip-defillama']).discovery).toBe('off')
    expect(parseArgs(['--no-discovery']).discovery).toBe('off')
    expect(parseArgs(['--url', 'https://a.example/eth,https://b.example/eth']).explicitUrls).toHaveLength(2)
    expect(parseArgs(['--limit', '3', '--timeout-ms=15000']).limit).toBe(3)
    expect(parseArgs(['--limit', '3', '--timeout-ms=15000']).timeoutMs).toBe(15000)
    expect(parseArgs([], { GAS_NOTIFY_RPC_LIST: 'wss://a.example/eth,https://b.example/eth' }).explicitUrls).toHaveLength(2)
  })
})

describe('cli run', () => {
  test('prints bounded grouped JSON on stdout for an explicit URL', async () => {
    const blockNumber = 23000000
    globalThis.fetch = jsonRpcStub((method) => {
      if (method === 'eth_chainId')
        return '0x1'
      if (method === 'eth_getBlockByNumber')
        return { number: hex(blockNumber), baseFeePerGas: '0x3b9aca00', timestamp: hex(Math.floor(Date.now() / 1000) - 3) }
      if (method === 'eth_feeHistory')
        return feeHistoryFixture(blockNumber - 4)
      throw new Error(`unexpected method ${method}`)
    })

    const stdout: string[] = []
    const originalStdout = process.stdout.write.bind(process.stdout)
    const originalStderr = process.stderr.write.bind(process.stderr)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(String(chunk))
      return true
    }) as typeof process.stdout.write
    process.stderr.write = (() => true) as typeof process.stderr.write
    try {
      const grouped = await main(['--url', 'https://unit.example/eth', '--no-defaults'], {})
      expect(grouped.http_confirmed).toHaveLength(1)
      expect(grouped.rejected).toHaveLength(0)
      const parsed = JSON.parse(stdout.join('')) as { http_confirmed: CandidateResult[] }
      expect(parsed.http_confirmed[0].url).toBe('https://unit.example/eth')
      expect(parsed.http_confirmed[0].history?.supported).toBe(true)
    }
    finally {
      process.stdout.write = originalStdout
      process.stderr.write = originalStderr
    }
  })
})
