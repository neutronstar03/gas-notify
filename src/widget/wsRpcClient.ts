import type { BlockResponse } from './types'
import { RPC_CONFIG } from './config'

interface JsonRpcResponse {
  id?: number
  error?: { message: string }
  result?: unknown
  method?: string
  params?: { subscription?: unknown, result?: { number?: string } }
}

export class WsRpcClient {
  private socket: WebSocket | null = null
  private requestId = 1
  private closePromise: Promise<{ code: number, reason: string }> | null = null
  private closeResolve: ((value: { code: number, reason: string }) => void) | null = null
  private readonly pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void, timer: number }>()
  private headHandler: ((blockNumber: string) => void | Promise<void>) | null = null
  private subscriptionId: unknown = null

  async connect(url: string): Promise<void> {
    const socket = new WebSocket(url)
    this.socket = socket
    this.closePromise = new Promise((resolve) => {
      this.closeResolve = resolve
    })

    socket.onmessage = (event) => {
      void this.handleMessage(event)
    }

    socket.onclose = (event) => {
      this.rejectPending(new Error(`WebSocket closed ${event.code} ${event.reason}`.trim()))
      this.closeResolve?.({ code: event.code, reason: event.reason })
    }

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('WebSocket open timeout')), RPC_CONFIG.timeoutMs)

      socket.onopen = () => {
        window.clearTimeout(timer)
        resolve()
      }

      socket.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error('WebSocket connection failed'))
      }
    })
  }

  async subscribeNewHeads(onHead: (blockNumber: string) => void | Promise<void>): Promise<void> {
    this.headHandler = onHead
    this.subscriptionId = await this.request('eth_subscribe', ['newHeads'])
  }

  async getBlockByNumber(blockTag: string): Promise<BlockResponse> {
    return await this.request('eth_getBlockByNumber', [blockTag, false]) as BlockResponse
  }

  async waitForClose(): Promise<{ code: number, reason: string }> {
    return await (this.closePromise ?? Promise.resolve({ code: 1000, reason: 'not-connected' }))
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
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`WebSocket RPC timeout for ${method}`))
      }, RPC_CONFIG.timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const payload = JSON.parse(String(event.data)) as JsonRpcResponse

    if (payload.id !== undefined) {
      const waiter = this.pending.get(payload.id)
      if (!waiter) {
        return
      }

      this.pending.delete(payload.id)
      window.clearTimeout(waiter.timer)
      if (payload.error) {
        waiter.reject(new Error(payload.error.message))
        return
      }

      waiter.resolve(payload.result)
      return
    }

    const isHead = payload.method === 'eth_subscription' && payload.params?.subscription === this.subscriptionId
    const blockNumber = payload.params?.result?.number
    if (!isHead || !blockNumber || !this.headHandler) {
      return
    }

    await this.headHandler(blockNumber)
  }

  private rejectPending(error: Error): void {
    for (const [id, waiter] of this.pending.entries()) {
      window.clearTimeout(waiter.timer)
      waiter.reject(error)
      this.pending.delete(id)
    }
  }
}
