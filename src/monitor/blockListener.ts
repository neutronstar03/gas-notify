import type { ScopedLogger } from '../logging/logger'
import type { AppConfig, BlockData, FeeObservation, NotificationEvent, RpcEndpoint } from '../types'
import { HttpRpcClient } from '../rpc/httpClient'
import { ProviderPool } from '../rpc/providerPool'
import { WsRpcClient } from '../rpc/wsClient'
import { blockHexToBigInt, ensureError, formatGwei, sleep, weiHexToGwei } from '../utils'

export class BlockListener {
  private stopRequested = false
  private readonly logger: ScopedLogger
  private readonly providerPool: ProviderPool
  private wsReconnectDelayMs: number
  private lastHealthyMode?: 'ws' | 'http'
  private lastWsRetryAt = 0

  constructor(
    private readonly config: AppConfig,
    private readonly onObservation: (observation: FeeObservation) => Promise<NotificationEvent[]>,
    logger: ScopedLogger,
  ) {
    this.logger = logger
    this.providerPool = new ProviderPool(config.preferredRpcs, config.fallbackRpcs)
    this.wsReconnectDelayMs = config.reconnectBaseDelayMs
  }

  async run(): Promise<void> {
    while (!this.stopRequested) {
      const wsProvider = this.providerPool.currentWs()
      if (wsProvider) {
        const succeeded = await this.runWsProvider(wsProvider)
        if (succeeded) {
          this.wsReconnectDelayMs = this.config.reconnectBaseDelayMs
          continue
        }
      }

      await this.runHttpFallback()
    }
  }

  stop(): void {
    this.stopRequested = true
  }

  private async runWsProvider(provider: RpcEndpoint): Promise<boolean> {
    const client = new WsRpcClient(provider.url, this.config.rpcRequestTimeoutMs)
    this.logger.info('Connecting WebSocket RPC', { provider: provider.name, url: provider.url })

    try {
      await client.connect()
      this.markHealthy('ws', provider)

      await client.subscribeNewHeads(async (head) => {
        if (this.stopRequested) {
          client.close()
          return
        }

        const blockTag = head.number ?? 'latest'
        const block = await client.getBlockByNumber(blockTag)
        await this.processBlock(block, provider, 'ws')
      })

      const closed = await client.waitForClose()
      throw new Error(`WebSocket closed ${closed.code} ${closed.reason}`)
    }
    catch (error) {
      const message = ensureError(error).message
      this.logger.warn('WebSocket provider failed', { provider: provider.name, message })
      const nextProvider = this.providerPool.rotateWs()
      if (this.config.notifyOnRpcFailover && nextProvider && nextProvider.name !== provider.name) {
        this.logger.info('Rotating to next WebSocket provider', { from: provider.name, to: nextProvider.name })
      }
      await sleep(this.wsReconnectDelayMs)
      this.wsReconnectDelayMs = Math.min(this.wsReconnectDelayMs * 2, this.config.reconnectMaxDelayMs)
      return false
    }
    finally {
      client.close()
    }
  }

  private async runHttpFallback(): Promise<void> {
    const provider = this.providerPool.currentHttp()
    if (!provider) {
      this.logger.warn('No HTTP fallback RPC configured; waiting before retrying WebSocket')
      await sleep(this.config.httpPollIntervalMs)
      return
    }

    const client = new HttpRpcClient(provider.url, this.config.rpcRequestTimeoutMs)
    this.logger.warn('HTTP fallback active', { provider: provider.name, url: provider.url })

    while (!this.stopRequested) {
      try {
        const block = await client.getLatestBlock()
        this.markHealthy('http', provider)
        await this.processBlock(block, provider, 'http')
      }
      catch (error) {
        this.logger.warn('HTTP polling failed', { provider: provider.name, message: ensureError(error).message })
        const nextProvider = this.providerPool.rotateHttp()
        if (nextProvider && nextProvider.name !== provider.name) {
          this.logger.info('Rotating to next HTTP provider', { from: provider.name, to: nextProvider.name })
        }
        break
      }

      const now = Date.now()
      if (now - this.lastWsRetryAt >= this.config.wsRetryWhilePollingMs && this.providerPool.currentWs()) {
        this.lastWsRetryAt = now
        this.logger.info('Retrying WebSocket mode from HTTP fallback')
        return
      }

      await sleep(this.config.httpPollIntervalMs)
    }
  }

  private async processBlock(block: BlockData, provider: RpcEndpoint, mode: 'ws' | 'http'): Promise<void> {
    if (!block.baseFeePerGas) {
      throw new Error(`Missing baseFeePerGas for block ${block.number}`)
    }

    const observation: FeeObservation = {
      baseFeeGwei: weiHexToGwei(block.baseFeePerGas),
      blockNumber: blockHexToBigInt(block.number),
      blockNumberHex: block.number,
      timestampMs: block.timestamp ? Number(BigInt(block.timestamp)) * 1000 : Date.now(),
      providerName: provider.name,
      providerUrl: provider.url,
      mode,
    }

    this.logger.debug('Observed base fee', {
      provider: provider.name,
      mode,
      blockNumber: observation.blockNumber.toString(),
      baseFeeGwei: formatGwei(observation.baseFeeGwei),
    })
    await this.onObservation(observation)
  }

  private markHealthy(mode: 'ws' | 'http', provider: RpcEndpoint): void {
    if (this.lastHealthyMode !== mode && this.config.notifyOnRecovery) {
      this.logger.info('Transport mode active', { mode, provider: provider.name })
    }
    this.lastHealthyMode = mode
  }
}
