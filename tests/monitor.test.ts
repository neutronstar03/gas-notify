import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { RPC_CONFIG } from '../src/widget/config'
import { GasMonitor } from '../src/widget/monitor'

interface PendingFetch {
  resolve: (response: Response) => void
  method: string
  params: unknown[]
}

const originalConfig = {
  wsProviders: [...RPC_CONFIG.wsProviders],
  httpProviders: [...RPC_CONFIG.httpProviders],
  wsNoHeadTimeoutMs: RPC_CONFIG.wsNoHeadTimeoutMs,
  httpPollIntervalMs: RPC_CONFIG.httpPollIntervalMs,
}
const originalFetch = globalThis.fetch
const originalWebSocket = globalThis.WebSocket
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const activeMonitors: GasMonitor[] = []
let pendingFetches: PendingFetch[] = []

class SilentWebSocket {
  static readonly OPEN = 1
  static readonly instances: SilentWebSocket[] = []

  readyState = 0
  onopen: ((event: Event) => unknown) | null = null
  onerror: ((event: Event) => unknown) | null = null
  onmessage: ((event: MessageEvent) => unknown) | null = null
  onclose: ((event: CloseEvent) => unknown) | null = null
  readonly closeCodes: number[] = []

  constructor(_url: string) {
    SilentWebSocket.instances.push(this)
    setTimeout(() => {
      this.readyState = SilentWebSocket.OPEN
      this.onopen?.(new Event('open'))
    }, 0)
  }

  send(data: string): void {
    const request = JSON.parse(data) as { id: number, method: string }
    if (request.method !== 'eth_subscribe') {
      return
    }

    setTimeout(() => {
      this.onmessage?.({
        data: JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 'subscription-id' }),
      } as MessageEvent)
    }, 0)
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) {
      return
    }

    this.closeCodes.push(code)
    this.readyState = 3
    setTimeout(() => {
      this.onclose?.({ code, reason } as CloseEvent)
    }, 0)
  }
}

function blockResponse(blockNumber: bigint): Response {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      number: `0x${blockNumber.toString(16)}`,
      baseFeePerGas: '0x3b9aca00',
      timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
      gasUsed: '0x32',
      gasLimit: '0x64',
    },
  }), {
    headers: { 'content-type': 'application/json' },
  })
}

async function flushAsyncWork(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  pendingFetches = []
  SilentWebSocket.instances.length = 0
  RPC_CONFIG.wsProviders = []
  RPC_CONFIG.httpProviders = [
    { name: 'first', url: 'https://first.test' },
    { name: 'second', url: 'https://second.test' },
    { name: 'third', url: 'https://third.test' },
  ]
  RPC_CONFIG.httpPollIntervalMs = 1
  globalThis.fetch = ((_url: unknown, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body))
    return new Promise<Response>((resolve) => {
      pendingFetches.push({ resolve, method, params })
    })
  }) as typeof fetch
})

afterEach(async () => {
  for (const monitor of activeMonitors.splice(0)) {
    monitor.stop()
  }
  await flushAsyncWork()
  RPC_CONFIG.wsProviders = [...originalConfig.wsProviders]
  RPC_CONFIG.httpProviders = [...originalConfig.httpProviders]
  RPC_CONFIG.wsNoHeadTimeoutMs = originalConfig.wsNoHeadTimeoutMs
  RPC_CONFIG.httpPollIntervalMs = originalConfig.httpPollIntervalMs
  globalThis.fetch = originalFetch
  globalThis.WebSocket = originalWebSocket
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  }
  else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

describe('GasMonitor startup reliability', () => {
  test('keeps WebSocket health while HTTP supplies a newer observation', async () => {
    RPC_CONFIG.httpProviders = [{ name: 'fallback', url: 'https://fallback.test' }]
    RPC_CONFIG.wsProviders = [{ name: 'live', url: 'wss://live.test' }]
    RPC_CONFIG.wsNoHeadTimeoutMs = 1000
    Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
    globalThis.WebSocket = SilentWebSocket as unknown as typeof WebSocket
    const statuses: Array<{ message: string, mode: string | undefined }> = []
    const monitor = new GasMonitor({
      onObservation: () => {},
      onStatus: (message, mode) => statuses.push({ message, mode }),
    })
    activeMonitors.push(monitor)
    monitor.start()
    pendingFetches[0].resolve(blockResponse(10n))
    await new Promise(resolve => setTimeout(resolve, 15))
    const socket = SilentWebSocket.instances[0]
    socket.onmessage?.({ data: JSON.stringify({ method: 'eth_subscription', params: {
      subscription: 'subscription-id',
      result: { number: '0xb', baseFeePerGas: '0x64', timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, gasUsed: '0x32', gasLimit: '0x64' },
    } }) } as MessageEvent)
    await flushAsyncWork()
    pendingFetches[1].resolve(blockResponse(12n))
    await flushAsyncWork()
    expect(statuses.at(-1)).toEqual({ message: 'Live via live', mode: 'ws' })
  })

  test('does not publish history after stopping the monitor', async () => {
    RPC_CONFIG.httpProviders = [{ name: 'first', url: 'https://first.test' }]
    const estimates: Array<{ provisional: boolean }> = []
    const monitor = new GasMonitor({ onObservation: () => {}, onStatus: () => {}, onEstimate: estimate => estimates.push(estimate) })
    activeMonitors.push(monitor)
    monitor.start()
    pendingFetches[0].resolve(blockResponse(10n))
    await flushAsyncWork()
    const request = pendingFetches.find(item => item.method === 'eth_feeHistory')!
    monitor.stop()
    request.resolve(new Response(JSON.stringify({ result: { oldestBlock: '0xa', baseFeePerGas: ['0x64', '0x64'], gasUsedRatio: [0.5], reward: [['0x64']] } })))
    await flushAsyncWork()
    expect(estimates).toHaveLength(1)
    expect(estimates[0].provisional).toBe(true)
  })
  test('emits a provisional estimate then upgrades it from history without waiting for five live blocks', async () => {
    RPC_CONFIG.httpProviders = [{ name: 'first', url: 'https://first.test' }]
    const estimates: Array<{ feeWei: bigint, provisional: boolean }> = []
    const monitor = new GasMonitor({
      onObservation: () => {},
      onStatus: () => {},
      onEstimate: estimate => estimates.push(estimate),
    })
    activeMonitors.push(monitor)
    monitor.start()
    pendingFetches[0].resolve(blockResponse(10n))
    await flushAsyncWork()
    expect(estimates[0]).toMatchObject({ feeWei: 1100000000n, provisional: true })
    const history = pendingFetches.find(request => request.method === 'eth_feeHistory')!
    expect(history.params).toEqual(['0x5', '0xa', [60]])
    history.resolve(new Response(JSON.stringify({ result: {
      oldestBlock: '0xa',
      baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
      gasUsedRatio: [0.5],
      reward: [['0xbebc200']],
    } })))
    await flushAsyncWork()
    expect(estimates.at(-1)).toMatchObject({ feeWei: 1200000000n, provisional: false })
  })

  test('ignores fee history for a different head', async () => {
    RPC_CONFIG.httpProviders = [{ name: 'first', url: 'https://first.test' }]
    const estimates: Array<{ provisional: boolean }> = []
    const monitor = new GasMonitor({ onObservation: () => {}, onStatus: () => {}, onEstimate: value => estimates.push(value) })
    activeMonitors.push(monitor)
    monitor.start()
    pendingFetches[0].resolve(blockResponse(10n))
    await flushAsyncWork()
    pendingFetches.find(request => request.method === 'eth_feeHistory')!.resolve(new Response(JSON.stringify({ result: {
      oldestBlock: '0x9',
      baseFeePerGas: ['0x64', '0x64'],
      gasUsedRatio: [0.5],
      reward: [['0x64']],
    } })))
    await flushAsyncWork()
    expect(estimates).toHaveLength(1)
    expect(estimates[0].provisional).toBe(true)
  })

  test('tries another provider immediately after a polling failure', async () => {
    const monitor = new GasMonitor({ onObservation: () => {}, onStatus: () => {} })
    activeMonitors.push(monitor)
    monitor.start()
    for (const request of pendingFetches.slice()) request.resolve(blockResponse(10n))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(pendingFetches).toHaveLength(4)
    pendingFetches[3].resolve(new Response('unavailable', { status: 503 }))
    await flushAsyncWork()
    expect(pendingFetches).toHaveLength(5)
  })
  test('starts every HTTP provider immediately and ignores duplicate or older blocks', async () => {
    const seenBlocks: bigint[] = []
    const monitor = new GasMonitor({
      onObservation: observation => seenBlocks.push(observation.blockNumber),
      onStatus: () => {},
    })
    activeMonitors.push(monitor)

    monitor.start()
    expect(pendingFetches).toHaveLength(3)

    pendingFetches[0].resolve(blockResponse(10n))
    pendingFetches[1].resolve(blockResponse(10n))
    pendingFetches[2].resolve(blockResponse(9n))
    await flushAsyncWork()

    expect(seenBlocks).toEqual([10n])
  })

  test('does not emit a late HTTP result after stop', async () => {
    const seenBlocks: bigint[] = []
    RPC_CONFIG.httpProviders = [{ name: 'late', url: 'https://late.test' }]
    const monitor = new GasMonitor({
      onObservation: observation => seenBlocks.push(observation.blockNumber),
      onStatus: () => {},
    })
    activeMonitors.push(monitor)

    monitor.start()
    expect(pendingFetches).toHaveLength(1)
    monitor.stop()
    pendingFetches[0].resolve(blockResponse(11n))
    await flushAsyncWork()

    expect(seenBlocks).toEqual([])
  })

  test('closes and retries an open WebSocket that sends no heads', async () => {
    const statuses: string[] = []
    RPC_CONFIG.httpProviders = []
    RPC_CONFIG.wsProviders = [{ name: 'silent', url: 'wss://silent.test' }]
    RPC_CONFIG.wsNoHeadTimeoutMs = 5
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: globalThis,
      writable: true,
    })
    globalThis.WebSocket = SilentWebSocket as unknown as typeof WebSocket

    const monitor = new GasMonitor({
      onObservation: () => {},
      onStatus: message => statuses.push(message),
    })
    activeMonitors.push(monitor)
    monitor.start()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(SilentWebSocket.instances).toHaveLength(1)
    expect(SilentWebSocket.instances[0].closeCodes).toContain(4000)
    expect(statuses).toContain('WS silent via silent; reconnecting')
  })
})
