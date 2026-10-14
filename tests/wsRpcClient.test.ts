import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { WsRpcClient } from '../src/widget/wsRpcClient'

const originalWebSocket = globalThis.WebSocket
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

class TestSocket {
  static OPEN = 1
  static instances: TestSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number, reason: string }) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  constructor(_url: string) { TestSocket.instances.push(this) }
  close(): void {
    this.readyState = 3
    this.onclose?.({ code: 1000, reason: '' })
  }

  send(data: string): void {
    const request = JSON.parse(data)
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result: 'sub' }) }))
  }

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
}

beforeEach(() => {
  TestSocket.instances = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  globalThis.WebSocket = TestSocket as unknown as typeof WebSocket
})
afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  if (originalWindow)
    Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('WebSocket RPC lifecycle', () => {
  test('rejects a connection closed before opening without waiting for timeout', async () => {
    const client = new WsRpcClient()
    const opening = client.connect('wss://test')
    client.close()
    await expect(opening).rejects.toThrow('cancelled')
  })
  test('passes the full new-head payload and ignores other subscriptions', async () => {
    const client = new WsRpcClient()
    const opening = client.connect('wss://test')
    const socket = TestSocket.instances[0]
    socket.open()
    await opening
    const heads: string[] = []
    await client.subscribeNewHeads((_number, header) => {
      heads.push(header.baseFeePerGas!)
    })
    const result = { number: '0xa', baseFeePerGas: '0x64', timestamp: '0x1', gasUsed: '0x2', gasLimit: '0x4' }
    socket.onmessage?.({ data: JSON.stringify({ method: 'eth_subscription', params: { subscription: 'other', result } }) })
    socket.onmessage?.({ data: JSON.stringify({ method: 'eth_subscription', params: { subscription: 'sub', result } }) })
    await Promise.resolve()
    expect(heads).toEqual(['0x64'])
    client.close()
  })
})
