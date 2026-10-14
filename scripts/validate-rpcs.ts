// scripts/validate-rpcs.ts
// Validates Ethereum mainnet (chainId 1) RPC endpoints for the v2 gas estimator:
// eth_chainId, a fresh latest block, eth_feeHistory for reward/next-base-fee, and
// for WebSocket candidates an actually received newHeads notification.
//
// JSON grouped into ws_confirmed / http_confirmed / rejected goes to stdout.
// Source information and progress go to stderr.
import process from 'node:process'
import { RPC_CONFIG } from '../src/widget/config'

export type RpcCategory = 'ws_confirmed' | 'http_confirmed' | 'rejected'
export type RpcTransport = 'ws' | 'http'
export type HistorySource = 'ws' | 'http' | 'both' | 'none'

export interface ValidationOptions {
  timeoutMs: number
  wsNewHeadsTimeoutMs: number
  blockFreshnessMs: number
}

export const DEFAULT_VALIDATION_OPTIONS: ValidationOptions = {
  timeoutMs: 12000,
  wsNewHeadsTimeoutMs: 35000,
  blockFreshnessMs: 60000,
}

export const ETHEREUM_CHAIN_ID = 1n
export const FEE_HISTORY_BLOCK_COUNT = 5
export const FEE_HISTORY_REWARD_PERCENTILES = [60]
export const FEE_HISTORY_PARAMS: [string, string, number[]] = ['0x5', 'latest', FEE_HISTORY_REWARD_PERCENTILES]

const HEX_QUANTITY_PATTERN = /^0x[0-9a-f]+$/i
const DECIMAL_PATTERN = /^\d+$/

export interface BlockSummary {
  number: string
  numberDecimal: number
  timestamp: number
  ageSeconds: number
  baseFeeGwei: number
  fresh: boolean
}

export interface HistorySummary {
  supported: boolean
  source: HistorySource
  oldestBlock?: number
  blockCount?: number
  nextBaseFeeGwei?: number
  rewardsMinGwei?: number
  rewardsMaxGwei?: number
  usableRewards: boolean
  alignmentDelta?: number
  fresh?: boolean
  reason?: string
}

export interface LatencyBreakdown {
  totalMs: number
  connectMs?: number
  chainIdMs?: number
  blockMs?: number
  feeHistoryMs?: number
  newHeadsMs?: number
  feeHistoryHttpMs?: number
}

export interface Capabilities {
  chainId: boolean
  block: boolean
  newHeads?: boolean
  feeHistoryWs?: boolean
  feeHistoryHttp?: boolean
}

export interface CandidateResult {
  name: string
  url: string
  category: RpcCategory
  transport: RpcTransport
  details: string
  reason?: string
  suitable: boolean
  latencyMs: LatencyBreakdown
  block?: BlockSummary
  history?: HistorySummary
  capabilities?: Capabilities
}

export interface GroupedResults {
  ws_confirmed: CandidateResult[]
  http_confirmed: CandidateResult[]
  rejected: CandidateResult[]
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function ensureError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function isWsUrl(url: string): boolean {
  return url.startsWith('ws://') || url.startsWith('wss://')
}

export function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

export function toHttpEquivalent(url: string): string | null {
  if (url.startsWith('wss://'))
    return `https://${url.slice('wss://'.length)}`
  if (url.startsWith('ws://'))
    return `http://${url.slice('ws://'.length)}`
  return null
}

export function parseQuantity(value: unknown): bigint | null {
  if (typeof value === 'number')
    return Number.isInteger(value) && value >= 0 ? BigInt(value) : null
  if (typeof value === 'string' && HEX_QUANTITY_PATTERN.test(value))
    return BigInt(value)
  return null
}

export function normalizeChainId(value: unknown): bigint | null {
  const parsed = parseQuantity(value)
  if (parsed !== null)
    return parsed
  if (typeof value === 'string' && DECIMAL_PATTERN.test(value))
    return BigInt(value)
  return null
}

export function weiToGwei(wei: bigint): number {
  return Number(wei) / 1e9
}

export function formatGwei(value: number): string {
  return value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3)
}

// Skipped before validation so keyless or template endpoints do not use a slot.
export function isPlaceholderUrl(url: string): boolean {
  const lower = url.toLowerCase()
  if (lower.includes('$' + '{') || lower.includes('<') || lower.includes('>') || lower.includes('{'))
    return true
  if (lower.includes('your-api-key') || lower.includes('yourkey') || lower.includes('replace-this'))
    return true
  if (lower.includes('changeme') || lower.includes('placeholder'))
    return true
  if (lower.includes('/demo'))
    return true
  const queryIndex = lower.indexOf('?')
  if (queryIndex === -1)
    return false
  const params = new URLSearchParams(lower.slice(queryIndex + 1))
  for (const key of ['api_key', 'apikey', 'key', 'token']) {
    const value = params.get(key)
    if (value !== null && value === '')
      return true
    if (value === 'demo' || value === 'test')
      return true
  }
  return false
}

export function dedupeCandidates(urls: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of urls) {
    const url = raw.trim()
    if (!url || (!isWsUrl(url) && !isHttpUrl(url)))
      continue
    if (seen.has(url))
      continue
    seen.add(url)
    result.push(url)
  }
  return result
}

export function evaluateBlock(raw: unknown, nowMs: number, freshnessMs: number): { ok: true, block: BlockSummary } | { ok: false, reason: string } {
  if (!raw || typeof raw !== 'object')
    return { ok: false, reason: 'block request returned no result' }
  const block = raw as { number?: unknown, baseFeePerGas?: unknown, timestamp?: unknown }
  const number = parseQuantity(block.number)
  if (number === null)
    return { ok: false, reason: 'block missing a valid number' }
  const baseFee = parseQuantity(block.baseFeePerGas)
  if (baseFee === null || baseFee <= 0n)
    return { ok: false, reason: 'block missing a positive baseFeePerGas' }
  const timestamp = parseQuantity(block.timestamp)
  if (timestamp === null)
    return { ok: false, reason: 'block missing a valid timestamp' }
  const timestampMs = Number(timestamp) * 1000
  const ageSeconds = (nowMs - timestampMs) / 1000
  const fresh = ageSeconds >= -15 && ageSeconds * 1000 < freshnessMs
  return {
    ok: true,
    block: {
      number: typeof block.number === 'string' ? block.number : `0x${number.toString(16)}`,
      numberDecimal: Number(number),
      timestamp: timestampMs,
      ageSeconds: Math.round(ageSeconds * 10) / 10,
      baseFeeGwei: weiToGwei(baseFee),
      fresh,
    },
  }
}

// The shape the v2 estimator needs: projected next-block base fee plus usable
// reward percentiles, aligned with the latest block we observed.
export function evaluateFeeHistory(raw: unknown, latestBlockNumber: number | null): { ok: true, history: HistorySummary } | { ok: false, reason: string } {
  if (!raw || typeof raw !== 'object')
    return { ok: false, reason: 'feeHistory returned no result' }
  const result = raw as { oldestBlock?: unknown, baseFeePerGas?: unknown, gasUsedRatio?: unknown, reward?: unknown }
  const oldestBlock = parseQuantity(result.oldestBlock)
  if (oldestBlock === null)
    return { ok: false, reason: 'feeHistory missing oldestBlock' }
  if (!Array.isArray(result.baseFeePerGas) || result.baseFeePerGas.length < 2)
    return { ok: false, reason: 'feeHistory missing baseFeePerGas' }
  const blockCount = result.baseFeePerGas.length - 1
  const baseFees = result.baseFeePerGas.map(parseQuantity)
  if (baseFees.includes(null))
    return { ok: false, reason: 'feeHistory has an invalid baseFeePerGas entry' }
  const nextBaseFeeWei = baseFees.at(-1) as bigint
  if (nextBaseFeeWei <= 0n)
    return { ok: false, reason: 'feeHistory next-block base fee is not positive' }
  if (!Array.isArray(result.gasUsedRatio) || result.gasUsedRatio.length !== blockCount)
    return { ok: false, reason: 'feeHistory gasUsedRatio misaligned with base fees' }
  if (!result.gasUsedRatio.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1))
    return { ok: false, reason: 'feeHistory gasUsedRatio out of range' }
  const rewards: bigint[] = []
  if (!Array.isArray(result.reward) || result.reward.length !== blockCount)
    return { ok: false, reason: 'feeHistory missing reward percentiles for every block' }
  for (const row of result.reward) {
    if (!Array.isArray(row) || row.length !== FEE_HISTORY_REWARD_PERCENTILES.length)
      return { ok: false, reason: 'feeHistory reward rows must match the requested percentiles' }
    for (const value of row) {
      const parsed = parseQuantity(value)
      if (parsed === null)
        return { ok: false, reason: 'feeHistory has an invalid reward value' }
      rewards.push(parsed)
    }
  }
  // Zero tips are legitimate on empty blocks, so usability is shape only, not positivity.
  const newestBlock = Number(oldestBlock) + blockCount - 1
  const alignmentDelta = latestBlockNumber === null ? undefined : latestBlockNumber - newestBlock
  const fresh = alignmentDelta === undefined ? true : Math.abs(alignmentDelta) <= 2
  if (!fresh)
    return { ok: false, reason: `feeHistory misaligned with latest block (delta=${alignmentDelta})` }
  const rewardsGwei = rewards.map(weiToGwei)
  return {
    ok: true,
    history: {
      supported: true,
      source: 'none',
      oldestBlock: Number(oldestBlock),
      blockCount,
      nextBaseFeeGwei: weiToGwei(nextBaseFeeWei),
      rewardsMinGwei: Math.min(...rewardsGwei),
      rewardsMaxGwei: Math.max(...rewardsGwei),
      usableRewards: true,
      alignmentDelta,
      fresh,
    },
  }
}

export function groupResults(results: CandidateResult[]): GroupedResults {
  return {
    ws_confirmed: results.filter(result => result.category === 'ws_confirmed'),
    http_confirmed: results.filter(result => result.category === 'http_confirmed'),
    rejected: results.filter(result => result.category === 'rejected'),
  }
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let cursor = 0
  const size = Math.max(1, Math.min(concurrency, items.length || 1))
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length)
        return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

export class HttpRpc {
  private nextId = 1

  constructor(private readonly url: string, private readonly timeoutMs: number) {}

  async request(method: string, params: unknown[]): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: controller.signal,
      })
      if (!response.ok)
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      const payload = await response.json() as { error?: { message?: string }, result?: unknown }
      if (payload.error)
        throw new Error(payload.error.message ?? (`${method} returned an RPC error`))
      return payload.result
    }
    catch (error) {
      if (controller.signal.aborted)
        throw new Error(`${method} timeout after ${this.timeoutMs}ms`)
      throw ensureError(error)
    }
    finally {
      clearTimeout(timer)
    }
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface HeadWaiter {
  subscription: string
  resolve: (block: { number: string }) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class WsRpc {
  private socket: WebSocket | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly headWaiters = new Set<HeadWaiter>()

  constructor(private readonly url: string, private readonly timeoutMs: number) {}

  async connect(openTimeoutMs = this.timeoutMs): Promise<void> {
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.onmessage = (event) => {
      this.handleMessage(event)
    }
    socket.onclose = (event) => {
      this.failAll(new Error(`socket closed ${event.code}`))
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled)
          return
        settled = true
        reject(new Error(`connect timeout after ${openTimeoutMs}ms`))
      }, openTimeoutMs)
      socket.onopen = () => {
        if (settled)
          return
        settled = true
        clearTimeout(timer)
        resolve()
      }
      socket.onerror = () => {
        if (settled)
          return
        settled = true
        clearTimeout(timer)
        reject(new Error('WebSocket connection failed'))
      }
    })
  }

  async request(method: string, params: unknown[]): Promise<unknown> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN)
      throw new Error(`WebSocket not open for ${method}`)
    return await new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timeout after ${this.timeoutMs}ms`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      }
      catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(ensureError(error))
      }
    })
  }

  async subscribeNewHeads(): Promise<string> {
    const subscription = await this.request('eth_subscribe', ['newHeads'])
    if (typeof subscription !== 'string' && typeof subscription !== 'number')
      throw new Error('eth_subscribe did not return a subscription id')
    return String(subscription)
  }

  async waitForNewHead(subscription: string, waitMs: number): Promise<{ number: string }> {
    return await new Promise<{ number: string }>((resolve, reject) => {
      const waiter: HeadWaiter = {
        subscription,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.headWaiters.delete(waiter)
          reject(new Error(`no newHeads within ${Math.round(waitMs / 1000)}s (subscription acknowledged)`))
        }, waitMs),
      }
      this.headWaiters.add(waiter)
    })
  }

  async getBlockByNumber(blockTag: string): Promise<unknown> {
    return await this.request('eth_getBlockByNumber', [blockTag, false])
  }

  close(): void {
    const socket = this.socket
    this.socket = null
    this.failAll(new Error('socket closed'))
    if (!socket)
      return
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null
    socket.onopen = null
    try {
      socket.close()
    }
    catch { /* already closed */ }
  }

  private handleMessage(event: MessageEvent): void {
    let payload: { id?: number, error?: { message?: string }, result?: unknown, method?: string, params?: { subscription?: unknown, result?: { number?: unknown } } }
    try {
      payload = JSON.parse(String(event.data))
    }
    catch { return }
    if (payload.id !== undefined) {
      const waiter = this.pending.get(payload.id)
      if (!waiter)
        return
      this.pending.delete(payload.id)
      clearTimeout(waiter.timer)
      if (payload.error) {
        waiter.reject(new Error(payload.error.message ?? 'RPC error'))
        return
      }
      waiter.resolve(payload.result)
      return
    }
    if (payload.method !== 'eth_subscription')
      return
    const subscription = payload.params?.subscription === undefined ? '' : String(payload.params.subscription)
    const number = payload.params?.result?.number
    if (typeof number !== 'string' || !HEX_QUANTITY_PATTERN.test(number))
      return
    for (const waiter of this.headWaiters) {
      if (waiter.subscription !== subscription)
        continue
      this.headWaiters.delete(waiter)
      clearTimeout(waiter.timer)
      waiter.resolve({ number })
      return
    }
  }

  private failAll(error: Error): void {
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
      this.pending.delete(id)
    }
    for (const waiter of this.headWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.headWaiters.clear()
  }
}

// ---------------------------------------------------------------------------
// Candidate validators
// ---------------------------------------------------------------------------

function makeRejected(name: string, url: string, transport: RpcTransport, reason: string, latencyMs: LatencyBreakdown, extras: Partial<CandidateResult> = {}): CandidateResult {
  return { name, url, category: 'rejected', transport, details: reason, reason, suitable: false, latencyMs, ...extras }
}

function withTotal(latencyMs: LatencyBreakdown, startedAt: number): LatencyBreakdown {
  return { ...latencyMs, totalMs: Date.now() - startedAt }
}

export async function validateHttpCandidate(url: string, name: string, options: ValidationOptions): Promise<CandidateResult> {
  const startedAt = Date.now()
  const latencyMs: LatencyBreakdown = { totalMs: 0 }
  const rpc = new HttpRpc(url, options.timeoutMs)
  try {
    const chainStarted = Date.now()
    const chainId = normalizeChainId(await rpc.request('eth_chainId', []))
    latencyMs.chainIdMs = Date.now() - chainStarted
    if (chainId !== ETHEREUM_CHAIN_ID) {
      const got = chainId === null ? 'unparsable' : `0x${chainId.toString(16)}`
      return makeRejected(name, url, 'http', `chainId mismatch (expected 0x1, got ${got})`, withTotal(latencyMs, startedAt))
    }
    const blockStarted = Date.now()
    const blockRaw = await rpc.request('eth_getBlockByNumber', ['latest', false])
    latencyMs.blockMs = Date.now() - blockStarted
    const blockEval = evaluateBlock(blockRaw, Date.now(), options.blockFreshnessMs)
    if (!blockEval.ok)
      return makeRejected(name, url, 'http', `latest block invalid: ${blockEval.reason}`, withTotal(latencyMs, startedAt))
    if (!blockEval.block.fresh)
      return makeRejected(name, url, 'http', `latest block stale (age ${blockEval.block.ageSeconds}s)`, withTotal(latencyMs, startedAt), { block: blockEval.block })
    const historyStarted = Date.now()
    let historyRaw: unknown
    try {
      historyRaw = await rpc.request('eth_feeHistory', FEE_HISTORY_PARAMS)
    }
    catch (error) {
      latencyMs.feeHistoryMs = Date.now() - historyStarted
      return makeRejected(name, url, 'http', `feeHistory unsupported: ${ensureError(error).message}`, withTotal(latencyMs, startedAt), { block: blockEval.block, capabilities: { chainId: true, block: true, feeHistoryHttp: false } })
    }
    latencyMs.feeHistoryMs = Date.now() - historyStarted
    const historyEval = evaluateFeeHistory(historyRaw, blockEval.block.numberDecimal)
    if (!historyEval.ok)
      return makeRejected(name, url, 'http', `feeHistory unusable: ${historyEval.reason}`, withTotal(latencyMs, startedAt), { block: blockEval.block, capabilities: { chainId: true, block: true, feeHistoryHttp: false } })
    const history: HistorySummary = { ...historyEval.history, source: 'http' }
    latencyMs.totalMs = Date.now() - startedAt
    return {
      name,
      url,
      category: 'http_confirmed',
      transport: 'http',
      details: ['chainId=0x1', `block=${blockEval.block.numberDecimal}`, `age=${blockEval.block.ageSeconds}s`, `baseFee=${formatGwei(blockEval.block.baseFeeGwei)}gwei`, `feeHistory=${history.blockCount}blocks`, `next=${formatGwei(history.nextBaseFeeGwei ?? 0)}gwei`, `rewards=${formatGwei(history.rewardsMinGwei ?? 0)}-${formatGwei(history.rewardsMaxGwei ?? 0)}gwei`, `latency=${latencyMs.totalMs}ms`].join(' '),
      suitable: true,
      latencyMs,
      block: blockEval.block,
      history,
      capabilities: { chainId: true, block: true, feeHistoryHttp: true },
    }
  }
  catch (error) {
    return makeRejected(name, url, 'http', `request failed: ${ensureError(error).message}`, withTotal(latencyMs, startedAt))
  }
}

export async function validateWsCandidate(url: string, name: string, options: ValidationOptions): Promise<CandidateResult> {
  const startedAt = Date.now()
  const latencyMs: LatencyBreakdown = { totalMs: 0 }
  const client = new WsRpc(url, options.timeoutMs)
  try {
    const connectStarted = Date.now()
    await client.connect(options.timeoutMs)
    latencyMs.connectMs = Date.now() - connectStarted
    const chainStarted = Date.now()
    const chainId = normalizeChainId(await client.request('eth_chainId', []))
    latencyMs.chainIdMs = Date.now() - chainStarted
    if (chainId !== ETHEREUM_CHAIN_ID) {
      const got = chainId === null ? 'unparsable' : `0x${chainId.toString(16)}`
      return makeRejected(name, url, 'ws', `chainId mismatch (expected 0x1, got ${got})`, withTotal(latencyMs, startedAt))
    }
    let subscription: string
    try {
      subscription = await client.subscribeNewHeads()
    }
    catch (error) {
      return makeRejected(name, url, 'ws', `eth_subscribe newHeads failed: ${ensureError(error).message}`, withTotal(latencyMs, startedAt), { capabilities: { chainId: true, block: false, newHeads: false } })
    }
    const headStarted = Date.now()
    let head: { number: string }
    try {
      head = await client.waitForNewHead(subscription, options.wsNewHeadsTimeoutMs)
    }
    catch (error) {
      return makeRejected(name, url, 'ws', `newHeads not confirmed: ${ensureError(error).message}`, withTotal(latencyMs, startedAt), { capabilities: { chainId: true, block: false, newHeads: false } })
    }
    latencyMs.newHeadsMs = Date.now() - headStarted
    const blockStarted = Date.now()
    const blockRaw = await client.getBlockByNumber(head.number)
    latencyMs.blockMs = Date.now() - blockStarted
    const blockEval = evaluateBlock(blockRaw, Date.now(), options.blockFreshnessMs)
    if (!blockEval.ok)
      return makeRejected(name, url, 'ws', `block retrieval invalid: ${blockEval.reason}`, withTotal(latencyMs, startedAt), { capabilities: { chainId: true, block: false, newHeads: true } })
    if (blockEval.block.number !== head.number)
      return makeRejected(name, url, 'ws', `block mismatch (head=${head.number} block=${blockEval.block.number})`, withTotal(latencyMs, startedAt), { capabilities: { chainId: true, block: false, newHeads: true } })
    if (!blockEval.block.fresh)
      return makeRejected(name, url, 'ws', `block stale (age ${blockEval.block.ageSeconds}s)`, withTotal(latencyMs, startedAt), { block: blockEval.block, capabilities: { chainId: true, block: true, newHeads: true } })

    const capabilities: Capabilities = { chainId: true, block: true, newHeads: true, feeHistoryWs: false, feeHistoryHttp: false }
    let wsHistory: HistorySummary | null = null
    let httpHistory: HistorySummary | null = null
    const wsHistoryStarted = Date.now()
    try {
      const evaluated = evaluateFeeHistory(await client.request('eth_feeHistory', FEE_HISTORY_PARAMS), blockEval.block.numberDecimal)
      wsHistory = evaluated.ok ? { ...evaluated.history, source: 'ws' } : { supported: false, source: 'none', usableRewards: false, reason: evaluated.reason }
      capabilities.feeHistoryWs = evaluated.ok
    }
    catch (error) {
      wsHistory = { supported: false, source: 'none', usableRewards: false, reason: `unsupported: ${ensureError(error).message}` }
    }
    latencyMs.feeHistoryMs = Date.now() - wsHistoryStarted

    const httpUrl = toHttpEquivalent(url)
    if (httpUrl) {
      const httpHistoryStarted = Date.now()
      try {
        const evaluated = evaluateFeeHistory(await new HttpRpc(httpUrl, options.timeoutMs).request('eth_feeHistory', FEE_HISTORY_PARAMS), blockEval.block.numberDecimal)
        httpHistory = evaluated.ok ? { ...evaluated.history, source: 'http' } : { supported: false, source: 'none', usableRewards: false, reason: evaluated.reason }
        capabilities.feeHistoryHttp = evaluated.ok
      }
      catch (error) {
        httpHistory = { supported: false, source: 'none', usableRewards: false, reason: `unsupported: ${ensureError(error).message}` }
      }
      latencyMs.feeHistoryHttpMs = Date.now() - httpHistoryStarted
    }

    const history: HistorySummary = wsHistory?.supported && httpHistory?.supported
      ? { ...wsHistory, source: 'both' }
      : wsHistory?.supported ? wsHistory : httpHistory?.supported ? httpHistory : (wsHistory ?? httpHistory ?? { supported: false, source: 'none', usableRewards: false, reason: 'not attempted' })
    const historyNote = capabilities.feeHistoryWs && capabilities.feeHistoryHttp
      ? 'feeHistory=ws+http'
      : capabilities.feeHistoryWs
        ? 'feeHistory=ws'
        : capabilities.feeHistoryHttp
          ? 'feeHistory=http'
          : `feeHistory=none (${history.reason ?? 'unsupported'})`
    latencyMs.totalMs = Date.now() - startedAt
    return {
      name,
      url,
      category: 'ws_confirmed',
      transport: 'ws',
      details: ['chainId=0x1', `newHeads=${(latencyMs.newHeadsMs / 1000).toFixed(1)}s`, `block=${blockEval.block.numberDecimal}`, `age=${blockEval.block.ageSeconds}s`, `baseFee=${formatGwei(blockEval.block.baseFeeGwei)}gwei`, historyNote, `latency=${latencyMs.totalMs}ms`].join(' '),
      suitable: capabilities.feeHistoryWs === true || capabilities.feeHistoryHttp === true,
      latencyMs,
      block: blockEval.block,
      history,
      capabilities,
    }
  }
  catch (error) {
    return makeRejected(name, url, 'ws', `request failed: ${ensureError(error).message}`, withTotal(latencyMs, startedAt))
  }
  finally {
    client.close()
  }
}

export async function validateCandidate(url: string, name: string, options: ValidationOptions): Promise<CandidateResult> {
  return isWsUrl(url) ? await validateWsCandidate(url, name, options) : await validateHttpCandidate(url, name, options)
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface DiscoveryResult {
  source: string
  url: string
  candidates: string[]
  rawCount: number
  skipped: number
}

export const CHAINLIST_RPCS_URL = 'https://chainlist.org/rpcs.json'

export async function loadChainlistCandidates(options: { fetchImpl?: typeof fetch, url?: string, timeoutMs?: number } = {}): Promise<DiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const url = options.url ?? CHAINLIST_RPCS_URL
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok)
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    const payload = await response.json()
    if (!Array.isArray(payload))
      throw new Error('unexpected rpcs.json shape (not an array)')
    const chain = payload.find(entry => entry && typeof entry === 'object' && String((entry as { chainId?: unknown }).chainId) === '1')
    if (!chain)
      throw new Error('chainId 1 not found in rpcs.json')
    const rpcList = (chain as { rpc?: unknown }).rpc
    if (!Array.isArray(rpcList))
      throw new Error('chainId 1 entry has no rpc array')
    const urls: string[] = []
    let skipped = 0
    for (const item of rpcList) {
      let candidate: unknown
      if (typeof item === 'string')
        candidate = item
      else if (item && typeof item === 'object')
        candidate = (item as { url?: unknown }).url
      if (typeof candidate !== 'string' || candidate.trim() === '' || isPlaceholderUrl(candidate)) {
        skipped++
        continue
      }
      urls.push(candidate)
    }
    return { source: 'chainlist', url, candidates: dedupeCandidates(urls), rawCount: rpcList.length, skipped }
  }
  finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOptions {
  explicitUrls: string[]
  limit: number | null
  timeoutMs: number
  concurrency: number
  wsNewHeadsTimeoutMs: number
  noDefaults: boolean
  discovery: 'auto' | 'off' | 'force'
  help: boolean
}

export const DEFAULT_CONCURRENCY = 5

function readOptionValue(argv: string[], index: number, inline: string | undefined): string | null {
  if (inline !== undefined)
    return inline
  const next = argv[index + 1]
  return next === undefined || next.startsWith('--') ? null : next
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = {}): CliOptions {
  const options: CliOptions = { explicitUrls: [], limit: null, timeoutMs: DEFAULT_VALIDATION_OPTIONS.timeoutMs, concurrency: DEFAULT_CONCURRENCY, wsNewHeadsTimeoutMs: DEFAULT_VALIDATION_OPTIONS.wsNewHeadsTimeoutMs, noDefaults: false, discovery: 'auto', help: false }
  const pushUrls = (value: string): void => {
    for (const part of value.split(',')) {
      const url = part.trim()
      if (url)
        options.explicitUrls.push(url)
    }
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const eq = arg.indexOf('=')
    const flag = arg.startsWith('--') && eq !== -1 ? arg.slice(0, eq) : arg
    const inline = arg.startsWith('--') && eq !== -1 ? arg.slice(eq + 1) : undefined
    const numeric = (value: string | null, apply: (parsed: number) => void): void => {
      if (value === null)
        return
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed) && parsed > 0)
        apply(parsed)
    }
    switch (flag) {
      case '--url':
      case '--urls': {
        const value = readOptionValue(argv, index, inline)
        if (value === null)
          break
        if (inline === undefined)
          index++
        pushUrls(value)
        break
      }
      case '--limit': {
        const value = readOptionValue(argv, index, inline)
        if (inline === undefined)
          index++
        numeric(value, (parsed) => {
          options.limit = parsed
        })
        break
      }
      case '--timeout-ms': {
        const value = readOptionValue(argv, index, inline)
        if (inline === undefined)
          index++
        numeric(value, (parsed) => {
          options.timeoutMs = parsed
        })
        break
      }
      case '--concurrency': {
        const value = readOptionValue(argv, index, inline)
        if (inline === undefined)
          index++
        numeric(value, (parsed) => {
          options.concurrency = Math.max(1, Math.min(parsed, 8))
        })
        break
      }
      case '--ws-wait-ms': {
        const value = readOptionValue(argv, index, inline)
        if (inline === undefined)
          index++
        numeric(value, (parsed) => {
          options.wsNewHeadsTimeoutMs = parsed
        })
        break
      }
      case '--skip-defillama':
        options.discovery = 'off'
        break
      case '--no-defaults':
        options.noDefaults = true
        break
      case '--no-discovery':
        options.discovery = 'off'
        break
      case '--discovery':
        options.discovery = 'force'
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default: break
    }
  }
  if (env.GAS_NOTIFY_RPC_LIST)
    pushUrls(env.GAS_NOTIFY_RPC_LIST)
  options.explicitUrls = dedupeCandidates(options.explicitUrls)
  return options
}

export const HELP_TEXT = [
  'Usage: bun run validate:rpcs [options]',
  '',
  'Validates Ethereum mainnet (chainId 1) RPC endpoints for the v2 gas estimator.',
  '',
  'Candidates:',
  '  (none)                 defaults + Chainlist rpcs.json',
  '  --url URL[,URL...]     validate only these URLs (repeatable); disables discovery',
  '  GAS_NOTIFY_RPC_LIST    comma-separated URLs, same as --url',
  '  --skip-defillama       legacy alias for --no-discovery',
  '  --no-discovery         no external source (defaults and explicit URLs only)',
  '  --discovery            force discovery even with explicit URLs',
  '  --no-defaults          exclude the built-in defaults',
  '',
  'Bounds:',
  '  --limit N              validate at most N candidates',
  '  --timeout-ms N         per JSON-RPC request timeout (default 12000)',
  '  --ws-wait-ms N         max wait for a real newHeads notification (default 35000)',
  '  --concurrency N        parallel validators, clamped to 1..8 (default 5)',
  '',
  'Output: JSON on stdout (ws_confirmed / http_confirmed / rejected); stderr carries source and progress.',
  '',
].join('\n')

function defaultCandidates(): { name: string, url: string }[] {
  const list: { name: string, url: string }[] = []
  for (const provider of RPC_CONFIG.wsProviders) list.push({ name: `default:${provider.name}`, url: provider.url })
  for (const provider of RPC_CONFIG.httpProviders) list.push({ name: `default:${provider.name}`, url: provider.url })
  return list
}

export async function main(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<GroupedResults> {
  const options = parseArgs(argv, env)
  if (options.help) {
    process.stdout.write(HELP_TEXT)
    return { ws_confirmed: [], http_confirmed: [], rejected: [] }
  }
  const writeErr = (line: string): void => {
    process.stderr.write(`${line}\n`)
  }
  const candidates = new Map<string, { name: string, url: string }>()
  const addCandidate = (name: string, url: string): void => {
    if (!candidates.has(url))
      candidates.set(url, { name, url })
  }
  const addUrl = (url: string, prefix: string): void => {
    const trimmed = url.trim()
    if (!trimmed || (!isWsUrl(trimmed) && !isHttpUrl(trimmed)))
      return
    if (isPlaceholderUrl(trimmed)) {
      writeErr(`[skip] placeholder or keyless URL ${trimmed}`)
      return
    }
    addCandidate(`${prefix}:${trimmed}`, trimmed)
  }

  options.explicitUrls.forEach((url, index) => {
    addUrl(url, `explicit-${index + 1}`)
  })
  if (!options.noDefaults) {
    for (const item of defaultCandidates()) addCandidate(item.name, item.url)
  }
  const defaultsCount = candidates.size

  const useDiscovery = options.discovery === 'force' || (options.discovery === 'auto' && options.explicitUrls.length === 0)
  if (useDiscovery) {
    try {
      const chainlist = await loadChainlistCandidates()
      chainlist.candidates.forEach((url, index) => {
        addCandidate(`chainlist-${index + 1}`, url)
      })
      writeErr(`[source] chainlist: kept ${chainlist.candidates.length}/${chainlist.rawCount} (${chainlist.skipped} skipped)`)
    }
    catch (error) { writeErr(`[discovery] chainlist failed, continuing: ${ensureError(error).message}`) }
  }
  else {
    writeErr('[source] discovery skipped (explicit list or --no-discovery)')
  }

  let list = [...candidates.values()]
  list = options.limit !== null ? list.slice(0, options.limit) : list
  writeErr(`[source] defaults+explicit=${defaultsCount} after-discovery=${candidates.size} validating=${list.length}`)
  if (options.limit === null && list.length > 20)
    writeErr(`[hint] ${list.length} candidates; pass --limit N for a bounded run`)
  if (list.length === 0)
    writeErr('[warn] no candidates to validate')

  const validationOptions: ValidationOptions = { timeoutMs: options.timeoutMs, wsNewHeadsTimeoutMs: options.wsNewHeadsTimeoutMs, blockFreshnessMs: DEFAULT_VALIDATION_OPTIONS.blockFreshnessMs }
  const startedAt = Date.now()
  const results = await mapWithConcurrency(list, options.concurrency, async (candidate) => {
    writeErr(`[validate] ${candidate.name} ${candidate.url}`)
    const result = await validateCandidate(candidate.url, candidate.name, validationOptions)
    writeErr(`[result] ${result.category} ${result.url} :: ${result.details}`)
    return result
  })

  writeErr(`[done] ${results.length} candidates in ${Date.now() - startedAt}ms`)
  const grouped = groupResults(results)
  process.stdout.write(`${JSON.stringify(grouped, null, 2)}\n`)
  return grouped
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`[fatal] ${ensureError(error).message}\n`)
    process.exitCode = 1
  })
}
