import type { ConnectionMode, Observation, Provider } from './types'
import { RPC_CONFIG } from './config'
import { requestHttp, toObservation } from './rpc'
import { ensureError, sleep } from './utils'
import { WsRpcClient } from './wsRpcClient'

export class GasMonitor {
  private stopRequested = true
  private generation = 0
  private activeClient: WsRpcClient | null = null
  private activeHttpController: AbortController | null = null
  private latestBlockNumber: bigint | null = null
  private wsLive = false

  constructor(
    private readonly handlers: {
      onObservation: (observation: Observation) => void
      onStatus: (message: string, mode?: ConnectionMode) => void
    },
  ) {}

  start(): void {
    this.stop()
    this.stopRequested = false
    this.latestBlockNumber = null

    const generation = ++this.generation
    const httpController = new AbortController()
    this.activeHttpController = httpController
    void this.run(generation, httpController)
  }

  stop(): void {
    this.stopRequested = true
    this.generation++
    this.wsLive = false
    this.activeHttpController?.abort()
    this.activeHttpController = null
    this.activeClient?.close()
    this.activeClient = null
  }

  private async run(generation: number, httpController: AbortController): Promise<void> {
    await Promise.all([
      this.runHttpLoop(generation, httpController.signal),
      this.runWebSocketLoop(generation),
    ])

    if (this.activeHttpController === httpController) {
      this.activeHttpController = null
    }
  }

  private async runWebSocketLoop(generation: number): Promise<void> {
    let wsIndex = 0
    let wsDelay = RPC_CONFIG.reconnectBaseDelayMs

    if (RPC_CONFIG.wsProviders.length === 0) {
      this.setStatus(generation, 'No WebSocket provider configured', 'down')
      return
    }

    while (this.isActive(generation)) {
      const wsProvider = RPC_CONFIG.wsProviders[wsIndex]
      if (!wsProvider) {
        return
      }

      const receivedHead = await this.runWebSocketProvider(wsProvider, generation)
      if (!this.isActive(generation)) {
        return
      }

      wsIndex = (wsIndex + 1) % RPC_CONFIG.wsProviders.length
      await sleep(wsDelay)
      if (!this.isActive(generation)) {
        return
      }

      wsDelay = receivedHead
        ? RPC_CONFIG.reconnectBaseDelayMs
        : Math.min(wsDelay * 2, RPC_CONFIG.reconnectMaxDelayMs)
    }
  }

  private async runHttpLoop(generation: number, signal: AbortSignal): Promise<void> {
    const providers = RPC_CONFIG.httpProviders
    if (providers.length === 0) {
      this.setStatus(generation, 'No HTTP fallback configured', 'down')
      return
    }

    // Query every configured HTTP provider at startup so a slow endpoint cannot
    // delay the first observation. The block gate below keeps the fastest/newest
    // response and discards duplicates or late older responses.
    const bootstrapResults = await Promise.all(providers.map(async (provider) => {
      return await this.requestHttpObservation(provider, generation, signal)
    }))

    if (!this.isActive(generation)) {
      return
    }

    if (!bootstrapResults.some(Boolean) && !this.wsLive) {
      this.setStatus(generation, 'HTTP bootstrap failed via all providers', 'down')
    }

    let httpIndex = 0
    while (this.isActive(generation)) {
      await sleep(RPC_CONFIG.httpPollIntervalMs)
      if (!this.isActive(generation)) {
        return
      }

      await this.requestHttpObservation(providers[httpIndex], generation, signal)
      httpIndex = (httpIndex + 1) % providers.length
    }
  }

  private async runWebSocketProvider(provider: Provider, generation: number): Promise<boolean> {
    this.setStatus(generation, `Connecting to ${provider.name}`, 'down')

    const client = new WsRpcClient()
    this.activeClient = client
    let receivedHead = false
    let noHeadTimer: number | null = null
    let noHeadTimedOut = false

    const armNoHeadTimer = (): void => {
      if (noHeadTimer !== null) {
        window.clearTimeout(noHeadTimer)
      }

      noHeadTimer = window.setTimeout(() => {
        if (!this.isActive(generation)) {
          return
        }

        noHeadTimedOut = true
        this.wsLive = false
        this.setStatus(generation, `WS silent via ${provider.name}; reconnecting`, 'down')
        client.close(4000, 'No new heads')
      }, RPC_CONFIG.wsNoHeadTimeoutMs)
    }

    try {
      await client.connect(provider.url)
      if (!this.isActive(generation)) {
        return false
      }

      this.setStatus(generation, `Subscribing via ${provider.name}`, 'down')
      await client.subscribeNewHeads(async (blockNumber) => {
        if (!this.isActive(generation)) {
          return
        }

        receivedHead = true
        this.wsLive = true
        armNoHeadTimer()

        try {
          const block = await client.getBlockByNumber(blockNumber)
          if (!this.isActive(generation)) {
            return
          }

          this.emitObservation(toObservation(block, provider, 'ws'), generation)
          this.setStatus(generation, `Live via ${provider.name}`, 'ws')
        }
        catch (error) {
          this.setStatus(generation, `WS block skipped: ${ensureError(error).message}`, 'down')
        }
      })

      if (!this.isActive(generation)) {
        return receivedHead
      }

      this.setStatus(generation, `Subscribed via ${provider.name}`, 'ws')
      armNoHeadTimer()
      await client.waitForClose()

      if (this.isActive(generation)) {
        this.wsLive = false
        if (!noHeadTimedOut) {
          this.setStatus(generation, `WS disconnected: ${provider.name}`, 'down')
        }
      }

      return receivedHead
    }
    catch (error) {
      if (this.isActive(generation)) {
        this.wsLive = false
        this.setStatus(generation, `WS failed: ${ensureError(error).message}`, 'down')
      }
      return receivedHead
    }
    finally {
      if (noHeadTimer !== null) {
        window.clearTimeout(noHeadTimer)
      }
      client.close()
      if (this.activeClient === client) {
        this.activeClient = null
      }
    }
  }

  private async requestHttpObservation(provider: Provider, generation: number, signal: AbortSignal): Promise<boolean> {
    try {
      const block = await requestHttp(provider.url, 'eth_getBlockByNumber', ['latest', false], signal)
      if (!this.isActive(generation)) {
        return false
      }

      this.emitObservation(toObservation(block, provider, 'http'), generation)
      return true
    }
    catch (error) {
      if (this.isActive(generation) && !this.wsLive) {
        this.setStatus(generation, `HTTP failed via ${provider.name}: ${ensureError(error).message}`, 'down')
      }
      return false
    }
  }

  private emitObservation(observation: Observation, generation: number): void {
    if (!this.isActive(generation)) {
      return
    }

    if (this.latestBlockNumber !== null && observation.blockNumber <= this.latestBlockNumber) {
      return
    }

    this.latestBlockNumber = observation.blockNumber
    this.handlers.onObservation(observation)
  }

  private setStatus(generation: number, message: string, mode: ConnectionMode): void {
    if (this.isActive(generation)) {
      this.handlers.onStatus(message, mode)
    }
  }

  private isActive(generation: number): boolean {
    return !this.stopRequested && this.generation === generation
  }
}
