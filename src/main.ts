import process from 'node:process'
import { loadConfig, logConfigSummary } from './config'
import { Logger } from './logging/logger'
import { BlockListener } from './monitor/blockListener'
import { FeeEvaluator } from './monitor/feeEvaluator'
import { StateStore } from './monitor/stateStore'
import { SnoreToastNotifier } from './notifications/snoretoast'

async function main(): Promise<void> {
  const config = loadConfig()
  const logger = new Logger(config.logLevel, config.logFilePath)
  logConfigSummary(logger, config)

  const stateStore = new StateStore(config.stateFilePath)
  const evaluator = new FeeEvaluator(config.thresholds, stateStore.load(), config.notifyOnStartupState)
  const notifier = new SnoreToastNotifier(config, logger.child('notify'))
  const listener = new BlockListener(
    config,
    async (observation) => {
      const events = evaluator.evaluate(observation)
      for (const event of events) {
        logger.info('Threshold event emitted', {
          threshold: event.threshold.name,
          crossedTo: event.crossedTo,
          previousPosition: event.previousPosition,
          baseFeeGwei: event.observation.baseFeeGwei,
          blockNumber: event.observation.blockNumber.toString(),
          provider: event.observation.providerName,
          reason: event.reason,
        })
        await notifier.notify(event)
      }
      if (events.length === 0) {
        logger.debug('No notification emitted', {
          blockNumber: observation.blockNumber.toString(),
          baseFeeGwei: observation.baseFeeGwei,
          provider: observation.providerName,
        })
      }
      stateStore.save(evaluator.snapshot())
      return events
    },
    logger.child('monitor'),
  )

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      logger.info(`Received ${signal}; shutting down`)
      listener.stop()
      stateStore.save(evaluator.snapshot())
    })
  }

  await listener.run()
}

void main()
