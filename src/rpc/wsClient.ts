import type { BlockData } from '../types'
import { ensureError } from '../utils'

interface JsonRpcMessage {
  id?: number
  method?: string
  params?: {
    subscription?: string
    result?: unknown
  }
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

interface HeadPayload {
  number?: string
}

let nextRequestId = 1

export class WsRpcClient {
  private socket?: WebSocket
  private subscriptionId?: string
  private readonly pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  private readonly closeWaiters: Array<(event: CloseEvent) => void> = []

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
  ) {}

  async connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return
    }

    this.socket = new WebSocket(this.url)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`WebSocket open timeout after ${this.timeoutMs}ms`)), this.timeoutMs)
      const socket = this.socket!

      socket.onopen = () => {
        clearTimeout(timer)
        resolve()
      }

      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('WebSocket connection failed'))
      }

      socket.onmessage = (event) => {
        this.handleMessage(String(event.data))
      }

      socket.onclose = (event) => {
        clearTimeout(timer)
        this.rejectAllPending(new Error(`WebSocket closed (${event.code}) ${event.reason || 'no reason'}`))
        while (this.closeWaiters.length > 0) {
          this.closeWaiters.shift()?.(event)
        }
      }
    })
  }

  async subscribeNewHeads(onHead: (head: HeadPayload) => Promise<void> | void): Promise<void> {
    const subscription = await this.request<string>('eth_subscribe', ['newHeads'])
    this.subscriptionId = subscription

    const socket = this.requireSocket()
    socket.onmessage = async (event) => {
      const payload = this.parseMessage(String(event.data))
      if (payload.id !== undefined) {
        this.resolvePending(payload)
        return
      }

      const isHeadEvent = payload.method === 'eth_subscription' && payload.params?.subscription === this.subscriptionId
      if (isHeadEvent) {
        await onHead((payload.params?.result ?? {}) as HeadPayload)
      }
    }
  }

  async request<T>(method: string, params: unknown[]): Promise<T> {
    const socket = this.requireSocket()
    const id = nextRequestId++
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })

    const response = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`WebSocket RPC timeout for ${method}`))
      }, this.timeoutMs)

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      socket.send(message)
    })

    return response as T
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

  async waitForClose(): Promise<CloseEvent> {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
      return new CloseEvent('close', { code: 1000, reason: 'already closed' })
    }

    return new Promise<CloseEvent>((resolve) => {
      this.closeWaiters.push(resolve)
    })
  }

  close(): void {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close()
    }
  }

  private requireSocket(): WebSocket {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected')
    }
    return this.socket
  }

  private parseMessage(raw: string): JsonRpcMessage {
    try {
      return JSON.parse(raw) as JsonRpcMessage
    }
    catch (error) {
      throw new Error(`Invalid WebSocket JSON-RPC payload: ${ensureError(error).message}`)
    }
  }

  private handleMessage(raw: string): void {
    const payload = this.parseMessage(raw)
    this.resolvePending(payload)
  }

  private resolvePending(payload: JsonRpcMessage): void {
    if (payload.id === undefined) {
      return
    }

    const pending = this.pending.get(payload.id)
    if (!pending) {
      return
    }

    this.pending.delete(payload.id)
    if (payload.error) {
      pending.reject(new Error(`RPC ${payload.error.code}: ${payload.error.message}`))
      return
    }
    pending.resolve(payload.result)
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}
