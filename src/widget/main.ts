import { GasMonitor } from './monitor'
import { WidgetView } from './view'

const WIDGET_COLOR_KEY = 'widgetColor'
const WIDGET_SIZE_KEY = 'widgetSize'

const VALID_COLORS = ['green', 'pearl', 'magenta', 'fuchsia', 'lime'] as const
const VALID_SIZES = ['normal', 'large'] as const

type Color = typeof VALID_COLORS[number]
type Size = typeof VALID_SIZES[number]

function initializeTheme(): void {
  // Check URL params first (set by background script on window creation)
  const urlParams = new URLSearchParams(window.location.search)
  const urlColor = urlParams.get('color')
  const urlSize = urlParams.get('size')

  const color: Color = (urlColor && VALID_COLORS.includes(urlColor as Color)) ? urlColor as Color : 'green'
  const size: Size = (urlSize && VALID_SIZES.includes(urlSize as Size)) ? urlSize as Size : 'normal'

  applyTheme(color, size)
}

function applyTheme(color: Color, size: Size): void {
  document.documentElement.setAttribute('data-color', color)
  document.documentElement.setAttribute('data-size', size)
}

function listenForThemeChanges(): void {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'theme-change') {
      // Re-fetch current settings from storage
      chrome.storage.local.get([WIDGET_COLOR_KEY, WIDGET_SIZE_KEY]).then((result: { [WIDGET_COLOR_KEY]?: string, [WIDGET_SIZE_KEY]?: string }) => {
        const color = (result[WIDGET_COLOR_KEY] && VALID_COLORS.includes(result[WIDGET_COLOR_KEY] as Color))
          ? result[WIDGET_COLOR_KEY] as Color
          : 'green'
        const size = (result[WIDGET_SIZE_KEY] && VALID_SIZES.includes(result[WIDGET_SIZE_KEY] as Size))
          ? result[WIDGET_SIZE_KEY] as Size
          : 'normal'
        applyTheme(color, size)
      })
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
