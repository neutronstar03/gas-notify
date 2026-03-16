import type { ScopedLogger } from '../logging/logger'
import type { AppConfig, NotificationEvent } from '../types'
import { createRequire } from 'node:module'
import { formatGwei } from '../utils'
import { playNotificationSound } from './play-sound'

const require = createRequire(import.meta.url)
const toastedNotifier = require('toasted-notifier') as {
  notify: (
    options: Record<string, unknown>,
    callback?: (error: unknown, response?: unknown, metadata?: unknown) => void,
  ) => void
}

export class WindowsToastNotifier {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: ScopedLogger,
  ) {}

  async notify(event: NotificationEvent): Promise<void> {
    const title = event.threshold.message ?? this.config.notificationTitle
    const message = [
      `${formatGwei(event.observation.baseFeeGwei)} gwei ${event.crossedTo === 'below' ? '<=' : '>='} ${formatGwei(event.threshold.gwei)} gwei`,
      `Block ${event.observation.blockNumber.toString()} | ${event.observation.providerName}`,
      new Date(event.observation.timestampMs).toLocaleTimeString(),
    ].join('\n')

    if (this.config.playNotificationSound && this.config.notificationSoundPath) {
      playNotificationSound(this.config.notificationSoundPath, this.logger)
    }

    await new Promise<void>((resolve) => {
      toastedNotifier.notify({
        title,
        message,
        icon: this.config.notificationIconPath,
        appID: this.config.appId,
        sound: false,
        wait: false,
      }, (error) => {
        if (error) {
          this.logger.error('Native toast execution failed', {
            message: error instanceof Error ? error.message : String(error),
          })
          resolve()
          return
        }

        this.logger.info('Toast notification sent', {
          threshold: event.threshold.name,
          baseFeeGwei: event.observation.baseFeeGwei,
          blockNumber: event.observation.blockNumber.toString(),
          provider: event.observation.providerName,
        })
        resolve()
      })
    })
  }
}
