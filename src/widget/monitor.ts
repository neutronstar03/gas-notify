import type { ConnectionMode, Observation, Provider } from './types'
import { RPC_CONFIG } from './config'
import { requestHttp, toObservation } from './rpc'
import { ensureError, sleep } from './utils'
import { WsRpcClient } from './wsRpcClient'

export class GasMonitor {
  private stopRequested = false
  private activeClient: WsRpcClient | null = null

  constructor(
    private readonly handlers: {
      onObservation: (observation: Observation) => void
      onStatus: (message: string, mode?: ConnectionMode) => void
    },
  ) {}

  start(): void {
    this.stopRequested = false
    void this.run()
  }

  stop(): void {
    this.stopRequested = true
    this.activeClient?.close()
    this.activeClient = null
  }

  private async run(): Promise<void> {
    let wsIndex = 0
    let httpIndex = 0
    let wsDelay = RPC_CONFIG.reconnectBaseDelayMs

    while (!this.stopRequested) {
      const wsProvider = RPC_CONFIG.wsProviders[wsIndex]
      if (wsProvider) {
        const shouldRetryWsImmediately = await this.runWebSocketProvider(wsProvider)
        if (this.stopRequested) {
          return
        }

        if (!shouldRetryWsImmediately && RPC_CONFIG.wsProviders.length > 0) {
          wsIndex = (wsIndex + 1) % RPC_CONFIG.wsProviders.length
          await sleep(wsDelay)
          wsDelay = Math.min(wsDelay * 2, RPC_CONFIG.reconnectMaxDelayMs)
        }
      }

      const httpProvider = RPC_CONFIG.httpProviders[httpIndex]
      if (!httpProvider) {
        this.handlers.onStatus('No HTTP fallback configured', 'down')
        await sleep(RPC_CONFIG.httpPollIntervalMs)
        continue
      }

      const shouldRetryWs = await this.runHttpFallback(httpProvider)
      if (this.stopRequested) {
        return
      }

      if (!shouldRetryWs && RPC_CONFIG.httpProviders.length > 0) {
        httpIndex = (httpIndex + 1) % RPC_CONFIG.httpProviders.length
      }

      wsDelay = RPC_CONFIG.reconnectBaseDelayMs
    }
  }

  private async runWebSocketProvider(provider: Provider): Promise<boolean> {
    this.handlers.onStatus(`Connecting to ${provider.name}`, 'down')

    const client = new WsRpcClient()
    this.activeClient = client

    try {
      await client.connect(provider.url)
      this.handlers.onStatus(`Subscribing via ${provider.name}`, 'down')
      await client.subscribeNewHeads(async (blockNumber) => {
        const block = await client.getBlockByNumber(blockNumber)
        this.handlers.onObservation(toObservation(block, provider, 'ws'))
        this.handlers.onStatus(`Live via ${provider.name}`, 'ws')
      })

      this.handlers.onStatus(`Subscribed via ${provider.name}`, 'ws')
      await client.waitForClose()

      if (!this.stopRequested) {
        this.handlers.onStatus(`WS disconnected: ${provider.name}`, 'down')
      }

      return false
    }
    catch (error) {
      if (!this.stopRequested) {
        this.handlers.onStatus(`WS failed: ${ensureError(error).message}`, 'down')
      }
      return false
    }
    finally {
      client.close()
      if (this.activeClient === client) {
        this.activeClient = null
      }
    }
  }

  private async runHttpFallback(provider: Provider): Promise<boolean> {
    this.handlers.onStatus(`HTTP fallback via ${provider.name}`, 'http')

    try {
      const block = await requestHttp(provider.url, 'eth_getBlockByNumber', ['latest', false])
      this.handlers.onObservation(toObservation(block, provider, 'http'))
    }
    catch (error) {
      this.handlers.onStatus(`HTTP failed: ${ensureError(error).message}`, 'down')
      return false
    }

    await sleep(RPC_CONFIG.httpPollIntervalMs)
    return true
  }
}
