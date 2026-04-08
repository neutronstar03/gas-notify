import process from 'node:process'

const DEFILLAMA_EXTRA_RPCS_RAW = 'https://raw.githubusercontent.com/DefiLlama/chainlist/main/constants/extraRpcs.js'
const ETHEREUM_SECTION_PATTERN = /1:\s*\{[\s\S]*?rpcs:\s*\[(.*?)\]\s*,\s*privacyData/s
const RPC_ENTRY_PATTERN = /url:\s*"([^"]+)"|"(https?:[^"\s]+|wss?:[^"\s]+)"/g
const TRAILING_COMMA_PATTERN = /,$/
const TRAILING_ZERO_GWEI_PATTERN = /(?:\.0+|(?<=\.\d)0+)$/

interface RpcCandidate {
  name?: string
  url: string
}

interface BlockData {
  number?: string
  baseFeePerGas?: string
}

interface ValidationResult {
  name: string
  url: string
  category: 'ws_confirmed' | 'http_confirmed' | 'rejected'
  details: string
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const candidates = new Map<string, RpcCandidate>()

  if (!args.has('--skip-defillama')) {
    for (const rpc of await loadDefiLlamaCandidates()) {
      candidates.set(rpc.url, rpc)
    }
  }

  const envList = process.env.GAS_NOTIFY_RPC_LIST?.split(',').map(url => url.trim()).filter(Boolean) ?? []
  for (const url of envList) {
    candidates.set(url, { url })
  }

  if (candidates.size === 0) {
    for (const rpc of defaultCandidates()) {
      candidates.set(rpc.url, rpc)
    }
  }

  const results: ValidationResult[] = []
  for (const candidate of candidates.values()) {
    results.push(isWsUrl(candidate.url) ? await validateWs(candidate) : await validateHttp(candidate))
  }

  process.stdout.write(`${JSON.stringify(groupResults(results), null, 2)}\n`)
}

function defaultCandidates(): RpcCandidate[] {
  return [
    { name: 'publicnode-ws', url: 'wss://ethereum-rpc.publicnode.com' },
    { name: '0xrpc-ws', url: 'wss://0xrpc.io/eth' },
    { name: 'publicnode-http', url: 'https://ethereum-rpc.publicnode.com' },
    { name: '0xrpc-http', url: 'https://0xrpc.io/eth' },
  ]
}

async function loadDefiLlamaCandidates(): Promise<RpcCandidate[]> {
  const response = await fetch(DEFILLAMA_EXTRA_RPCS_RAW, { signal: AbortSignal.timeout(15000) })
  const text = await response.text()
  const ethereumSection = text.match(ETHEREUM_SECTION_PATTERN)
  if (!ethereumSection) {
    return []
  }

  const entries = [...ethereumSection[1].matchAll(RPC_ENTRY_PATTERN)]
  const urls = new Set<string>()
  for (const entry of entries) {
    const url = entry[1] ?? entry[2]
    if (url) {
      urls.add(url.replace(TRAILING_COMMA_PATTERN, ''))
    }
  }

  return Array.from(urls, (url, index) => ({ name: `defillama-${index + 1}`, url }))
}

async function validateWs(candidate: RpcCandidate): Promise<ValidationResult> {
  const client = new WsRpcClient(10000)
  try {
    await client.connect(candidate.url)
    await client.subscribeNewHeads()
    const block = await client.getBlockByNumber('latest')
    return confirmed(candidate, 'ws_confirmed', block)
  }
  catch (error) {
    return rejected(candidate, ensureError(error).message)
  }
  finally {
    client.close()
  }
}

async function validateHttp(candidate: RpcCandidate): Promise<ValidationResult> {
  try {
    const block = await requestHttp(candidate.url, 'eth_getBlockByNumber', ['latest', false], 10000) as BlockData
    return confirmed(candidate, 'http_confirmed', block)
  }
  catch (error) {
    return rejected(candidate, ensureError(error).message)
  }
}

function confirmed(candidate: RpcCandidate, category: ValidationResult['category'], block: BlockData): ValidationResult {
  if (!block.number || !block.baseFeePerGas) {
    return rejected(candidate, 'Block payload missing number/baseFeePerGas')
  }

  return {
    name: candidate.name ?? candidate.url,
    url: candidate.url,
    category,
    details: `ok block=${block.number} baseFeeGwei=${formatGwei(weiHexToGwei(block.baseFeePerGas))}`,
  }
}

function rejected(candidate: RpcCandidate, details: string): ValidationResult {
  return {
    name: candidate.name ?? candidate.url,
    url: candidate.url,
    category: 'rejected',
    details,
  }
}

function groupResults(results: ValidationResult[]): Record<string, ValidationResult[]> {
  return {
    ws_confirmed: results.filter(result => result.category === 'ws_confirmed'),
    http_confirmed: results.filter(result => result.category === 'http_confirmed'),
    rejected: results.filter(result => result.category === 'rejected'),
  }
}

async function requestHttp(url: string, method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  const payload = await response.json() as { error?: { message: string }, result?: unknown }
  if (payload.error) {
    throw new Error(payload.error.message)
  }

  return payload.result
}

class WsRpcClient {
  private socket: WebSocket | null = null
  private requestId = 1
  private subscriptionId: unknown = null
  private readonly pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void, timer: Timer }>()

  constructor(private readonly timeoutMs: number) {}

  async connect(url: string): Promise<void> {
    const socket = new WebSocket(url)
    this.socket = socket
    socket.onmessage = event => this.handleMessage(event)
    socket.onclose = (event) => {
      this.rejectPending(new Error(`WebSocket closed ${event.code} ${event.reason}`.trim()))
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), this.timeoutMs)

      socket.onopen = () => {
        clearTimeout(timer)
        resolve()
      }

      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('WebSocket connection failed'))
      }
    })
  }

  async subscribeNewHeads(): Promise<void> {
    this.subscriptionId = await this.request('eth_subscribe', ['newHeads'])
  }

  async getBlockByNumber(blockTag: string): Promise<BlockData> {
    return await this.request('eth_getBlockByNumber', [blockTag, false]) as BlockData
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }

  private async request(method: string, params: unknown[]): Promise<unknown> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`WebSocket is not open for ${method}`)
    }

    return await new Promise<unknown>((resolve, reject) => {
      const id = this.requestId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`WebSocket RPC timeout for ${method}`))
      }, this.timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  private handleMessage(event: MessageEvent): void {
    const payload = JSON.parse(String(event.data)) as {
      id?: number
      error?: { message: string }
      result?: unknown
      method?: string
      params?: { subscription?: unknown }
    }

    if (payload.id === undefined) {
      return
    }

    const waiter = this.pending.get(payload.id)
    if (!waiter) {
      return
    }

    this.pending.delete(payload.id)
    clearTimeout(waiter.timer)

    if (payload.error) {
      waiter.reject(new Error(payload.error.message))
      return
    }

    waiter.resolve(payload.result)
  }

  private rejectPending(error: Error): void {
    for (const [id, waiter] of this.pending.entries()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
      this.pending.delete(id)
    }
  }
}

function isWsUrl(url: string): boolean {
  return url.startsWith('ws://') || url.startsWith('wss://')
}

function weiHexToGwei(value: string): number {
  return Number(BigInt(value)) / 1e9
}

function formatGwei(value: number): string {
  return value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3).replace(TRAILING_ZERO_GWEI_PATTERN, '')
}

function ensureError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

void main()
