import type { ScopedLogger } from '../logging/logger'
import type { AppConfig, NotificationEvent } from '../types'
import fs from 'node:fs'
import path from 'node:path'
import { formatGwei } from '../utils'

export class SnoreToastNotifier {
  private available: boolean | undefined

  constructor(
    private readonly config: AppConfig,
    private readonly logger: ScopedLogger,
  ) {}

  async notify(event: NotificationEvent): Promise<void> {
    if (!this.canUseSnoreToast()) {
      this.logger.warn('SnoreToast unavailable; notification logged only', {
        threshold: event.threshold.name,
        baseFeeGwei: event.observation.baseFeeGwei,
      })
      return
    }

    const title = event.threshold.message ?? this.config.notificationTitle
    const body = [
      `${formatGwei(event.observation.baseFeeGwei)} gwei ${event.crossedTo === 'below' ? '<= ' : '>= '}${formatGwei(event.threshold.gwei)} gwei`,
      `Block ${event.observation.blockNumber.toString()} • ${event.observation.providerName}`,
      new Date(event.observation.timestampMs).toLocaleString(),
    ].join('\n')

    const args = [
      '-appID',
      this.config.appId,
      '-t',
      title,
      '-m',
      body,
    ]

    if (this.config.silentNotifications) {
      args.push('-silent')
    }

    const proc = Bun.spawn([this.config.snoreToastPath!, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      this.logger.error('SnoreToast execution failed', { exitCode, stderr: stderr.trim() })
      return
    }

    this.logger.info('Toast notification sent', {
      threshold: event.threshold.name,
      baseFeeGwei: event.observation.baseFeeGwei,
      blockNumber: event.observation.blockNumber.toString(),
      provider: event.observation.providerName,
    })
  }

  private canUseSnoreToast(): boolean {
    if (this.available !== undefined) {
      return this.available
    }

    const filePath = this.config.snoreToastPath
    this.available = Boolean(filePath && fs.existsSync(filePath) && path.basename(filePath).toLowerCase() === 'snoretoast.exe')
    return this.available
  }
}
