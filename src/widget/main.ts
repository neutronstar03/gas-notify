import { GasMonitor } from './monitor'
import { WidgetView } from './view'

const WIDGET_THEME_KEY = 'widgetTheme'

function initializeTheme(): void {
  // Check URL params first (set by background script on window creation)
  const urlParams = new URLSearchParams(window.location.search)
  const urlTheme = urlParams.get('theme')

  if (urlTheme === 'original' || urlTheme === 'large') {
    document.documentElement.setAttribute('data-theme', urlTheme)
    return
  }

  // Otherwise, check storage
  chrome.storage.local.get(WIDGET_THEME_KEY).then((result: { [WIDGET_THEME_KEY]?: string }) => {
    const theme = result[WIDGET_THEME_KEY] || 'original'
    document.documentElement.setAttribute('data-theme', theme)
  })
}

function listenForThemeChanges(): void {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'theme-change') {
      const theme = message.theme as string
      if (theme === 'original' || theme === 'large') {
        document.documentElement.setAttribute('data-theme', theme)
      }
    }
  })
}

export function startWidget(): void {
  // Initialize theme before rendering
  initializeTheme()
  listenForThemeChanges()

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
