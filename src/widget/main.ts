import { GasMonitor } from './monitor'
import { parseWidgetSettings, WIDGET_COLOR_KEY, WIDGET_SIZE_KEY } from './settings'
import { WidgetView } from './view'

function applyTheme(settings: { color: string, size: string }): void {
  document.documentElement.dataset.color = settings.color
  document.documentElement.dataset.size = settings.size
}

export function startWidget(): void {
  const params = new URLSearchParams(window.location.search)
  applyTheme(parseWidgetSettings({ widgetColor: params.get('color'), widgetSize: params.get('size') }))
  let themeRevision = 0
  const refreshTheme = async (): Promise<void> => {
    const revision = ++themeRevision
    const settings = await chrome.storage.local.get([WIDGET_COLOR_KEY, WIDGET_SIZE_KEY])
    if (revision === themeRevision)
      applyTheme(parseWidgetSettings(settings))
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[WIDGET_COLOR_KEY] || changes[WIDGET_SIZE_KEY])) {
      void refreshTheme().catch(error => console.warn('Theme update failed', error))
    }
  })
  void refreshTheme().catch(error => console.warn('Theme initialization failed', error))

  const view = new WidgetView()
  const monitor = new GasMonitor({
    onObservation: observation => view.setObservation(observation),
    onStatus: (message, mode = 'down') => view.setStatus(message, mode),
    onEstimate: estimate => view.setEstimate(estimate),
  })
  view.render()
  monitor.start()
  const ageTimer = window.setInterval(() => view.render(), 1000)
  window.addEventListener('beforeunload', () => {
    monitor.stop()
    window.clearInterval(ageTimer)
  }, { once: true })
}
