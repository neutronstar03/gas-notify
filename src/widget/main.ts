import { GasMonitor } from './monitor'
import { WidgetView } from './view'

export function startWidget(): void {
  const view = new WidgetView()
  const monitor = new GasMonitor({
    onObservation: (observation) => {
      view.setObservation(observation)
      view.setStatus(observation.mode === 'ws' ? `Live via ${observation.providerName}` : `HTTP via ${observation.providerName}`, observation.mode)
    },
    onStatus: (message, mode = 'down') => {
      view.setStatus(message, mode)
    },
  })

  view.render()
  monitor.start()

  const ageTimer = window.setInterval(() => view.render(), 1000)

  window.addEventListener('beforeunload', () => {
    monitor.stop()
    window.clearInterval(ageTimer)
  }, { once: true })
}
