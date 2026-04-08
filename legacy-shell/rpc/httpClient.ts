import type { BlockData } from '../types'
import { ensureError } from '../utils'

interface RpcSuccess<T> {
  jsonrpc: string
  id: number
  result: T
}

interface RpcFailure {
  jsonrpc: string
  id: number
  error: {
    code: number
    message: string
  }
}

let requestId = 1

export class HttpRpcClient {
  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
  ) {}

  async request<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const payload = (await response.json()) as RpcSuccess<T> | RpcFailure
    if ('error' in payload) {
      throw new Error(`RPC ${payload.error.code}: ${payload.error.message}`)
    }

    return payload.result
  }

  async getBlockByNumber(blockTag: string): Promise<BlockData> {
    const block = await this.request<BlockData | null>('eth_getBlockByNumber', [blockTag, false])
    if (!block) {
      throw new Error(`Null block result for ${blockTag}`)
    }
    if (!block.baseFeePerGas) {
      throw new Error(`Block ${block.number} did not include baseFeePerGas`)
    }
    return block
  }

  async getLatestBlock(): Promise<BlockData> {
    try {
      return await this.getBlockByNumber('latest')
    }
    catch (error) {
      throw new Error(`HTTP RPC latest block failed: ${ensureError(error).message}`)
    }
  }
}
