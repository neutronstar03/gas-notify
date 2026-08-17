import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { RPC_CONFIG } from '../src/widget/config'
import { GasMonitor } from '../src/widget/monitor'

interface PendingFetch {
  resolve: (response: Response) => void
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
      timestamp: '0x1',
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
  globalThis.fetch = (() => {
    return new Promise<Response>((resolve) => {
      pendingFetches.push({ resolve })
    })
  }) as typeof fetch
})

afterEach(() => {
  for (const monitor of activeMonitors.splice(0)) {
    monitor.stop()
  }
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
