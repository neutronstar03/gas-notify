import type { FeeObservation, NotificationEvent, PersistedState, ThresholdPosition, ThresholdRule } from '../types'

export class FeeEvaluator {
  private readonly state: PersistedState

  constructor(
    thresholds: ThresholdRule[],
    initialState: PersistedState,
    private readonly notifyOnStartupState: boolean,
  ) {
    this.thresholds = thresholds
    this.state = initialState
    this.state.thresholds ||= {}
  }

  private readonly thresholds: ThresholdRule[]

  evaluate(observation: FeeObservation): NotificationEvent[] {
    const events: NotificationEvent[] = []

    for (const threshold of this.thresholds) {
      const current = this.state.thresholds[threshold.name] ?? { position: 'unknown' as ThresholdPosition }
      const previousPosition = current.position
      const nextPosition = resolvePosition(observation.baseFeeGwei, threshold, previousPosition)
      const isCrossing = previousPosition !== 'unknown' && nextPosition !== previousPosition
      const cooldownMs = threshold.cooldownSeconds * 1000
      const cooldownActive = current.lastNotificationAt !== undefined && observation.timestampMs - current.lastNotificationAt < cooldownMs

      this.state.thresholds[threshold.name] = {
        position: nextPosition,
        lastNotificationAt: current.lastNotificationAt,
      }

      if (previousPosition === 'unknown' && !this.notifyOnStartupState) {
        continue
      }

      if (!isCrossing && previousPosition !== 'unknown') {
        continue
      }

      if (!matchesDirection(threshold.direction, nextPosition)) {
        continue
      }

      if (cooldownActive) {
        continue
      }

      this.state.thresholds[threshold.name].lastNotificationAt = observation.timestampMs
      events.push({
        threshold,
        observation,
        crossedTo: nextPosition,
        previousPosition,
        reason: previousPosition === 'unknown' ? 'startup-state' : 'threshold-crossing',
      })
    }

    this.state.lastSeenBlock = observation.blockNumber.toString()
    this.state.lastSeenBaseFeeGwei = observation.baseFeeGwei
    this.state.lastUpdatedAt = observation.timestampMs
    return events
  }

  snapshot(): PersistedState {
    return this.state
  }
}

function resolvePosition(baseFeeGwei: number, threshold: ThresholdRule, previous: ThresholdPosition): Exclude<ThresholdPosition, 'unknown'> {
  const thresholdValue = threshold.gwei
  const hysteresis = threshold.hysteresisGwei

  if (previous === 'below') {
    return baseFeeGwei > thresholdValue + hysteresis ? 'above' : 'below'
  }

  if (previous === 'above') {
    return baseFeeGwei < thresholdValue - hysteresis ? 'below' : 'above'
  }

  return baseFeeGwei <= thresholdValue ? 'below' : 'above'
}

function matchesDirection(direction: ThresholdRule['direction'], nextPosition: Exclude<ThresholdPosition, 'unknown'>): boolean {
  return direction === 'both' || direction === nextPosition
}
