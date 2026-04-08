import type { AppConfig, FeeObservation } from '../src/types'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { BlockListener } from '../src/monitor/blockListener'
import { formatGwei } from '../src/shared/core'
import '../src-app/styles.css'

type ThemeMode = 'playful' | 'plain'
type RowCount = 2 | 3 | 4

interface WidgetState {
  recent: FeeObservation[]
  connectionStatus: string
  metaSummary: string
  theme: ThemeMode
  rowCount: RowCount
}

const STORAGE_KEYS = {
  theme: 'gas-notify-tray-theme',
  rowCount: 'gas-notify-tray-row-count',
} as const

const state: WidgetState = {
  recent: [],
  connectionStatus: 'Connecting…',
  metaSummary: 'Waiting for first block…',
  theme: loadTheme(),
  rowCount: loadRowCount(),
}

const rowsEl = document.querySelector<HTMLDivElement>('#rows')!
const widgetShellEl = document.querySelector<HTMLElement>('#widget-shell')!
const connectionStatusEl = document.querySelector<HTMLSpanElement>('#connection-status')!
const metaSummaryEl = document.querySelector<HTMLSpanElement>('#meta-summary')!
const themeToggleEl = document.querySelector<HTMLButtonElement>('#theme-toggle')!
const rowToggleEl = document.querySelector<HTMLButtonElement>('#row-toggle')!
let activeListener: BlockListener | undefined
const currentWindow = getCurrentWindow()

themeToggleEl.addEventListener('click', () => {
  state.theme = state.theme === 'playful' ? 'plain' : 'playful'
  localStorage.setItem(STORAGE_KEYS.theme, state.theme)
  render()
})

rowToggleEl.addEventListener('click', () => {
  state.rowCount = nextRowCount(state.rowCount)
  localStorage.setItem(STORAGE_KEYS.rowCount, String(state.rowCount))
  render()
})

widgetShellEl.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return
  }

  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return
  }

  if (target.closest('.no-drag, button, input, select, textarea, a')) {
    return
  }

  void currentWindow.startDragging()
})

void initialize()
render()

async function initialize(): Promise<void> {
  await listen<string>('monitor-control', (event) => {
    if (event.payload === 'pause') {
      pauseMonitor()
      return
    }

    if (event.payload === 'resume') {
      void resumeMonitor()
    }
  })

  await resumeMonitor()
}

async function resumeMonitor(): Promise<void> {
  if (activeListener) {
    return
  }

  state.connectionStatus = 'Connecting…'
  render()

  const listener = new BlockListener(
    createWidgetConfig(),
    async (observation) => {
      state.recent = [observation, ...state.recent.filter(item => item.blockNumber !== observation.blockNumber)].slice(0, 4)
      state.connectionStatus = observation.mode === 'ws'
        ? `Live via ${observation.providerName}`
        : `HTTP fallback via ${observation.providerName}`
      state.metaSummary = `${state.recent.length} cached · updated ${formatAge(observation.timestampMs)} · ${observation.providerName}`
      render()
      return []
    },
    createUiLogger(),
  )
  activeListener = listener

  try {
    await listener.run()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    state.connectionStatus = 'Monitor stopped'
    state.metaSummary = message
    render()
  }
  finally {
    if (activeListener === listener) {
      activeListener = undefined
    }
  }
}

function pauseMonitor(): void {
  activeListener?.stop()
  activeListener = undefined
  state.connectionStatus = 'Monitoring paused'
  state.metaSummary = state.recent.length > 0 ? 'Tray menu can resume live updates' : 'No cached blocks yet'
  render()
}

function render(): void {
  document.documentElement.dataset.theme = state.theme
  connectionStatusEl.textContent = state.connectionStatus
  metaSummaryEl.textContent = state.metaSummary
  themeToggleEl.textContent = state.theme === 'playful' ? 'Playful' : 'Plain'
  rowToggleEl.textContent = `${state.rowCount} rows`

  const rows = state.recent.slice(0, state.rowCount)
  rowsEl.innerHTML = rows.length > 0
    ? rows.map((observation, index) => createRowMarkup(observation, index === 0)).join('')
    : `<div class="empty-state">No block data yet. The widget will fill as soon as the first RPC response lands.</div>`
}

function createRowMarkup(observation: FeeObservation, isLatest: boolean): string {
  const blockSuffix = observation.blockNumber.toString().slice(-4).padStart(4, '0')
  return `
    <article class="gas-row${isLatest ? ' is-latest' : ''}">
      <span class="gas-row__block">x${blockSuffix}</span>
      <strong class="gas-row__fee">${formatGwei(observation.baseFeeGwei)} gwei</strong>
      <span class="gas-row__age">${formatAge(observation.timestampMs)}</span>
    </article>
  `
}

function createWidgetConfig(): AppConfig {
  return {
    notificationTitle: 'Gas Notify',
    appId: 'Gas Notify',
    notificationIconPath: undefined,
    silentNotifications: true,
    playNotificationSound: false,
    notificationSoundPath: undefined,
    cooldownSeconds: 180,
    reconnectBaseDelayMs: 2000,
    reconnectMaxDelayMs: 30000,
    httpPollIntervalMs: 12000,
    wsRetryWhilePollingMs: 60000,
    rpcRequestTimeoutMs: 12000,
    notifyOnStartupState: false,
    notifyOnRecovery: true,
    notifyOnRpcFailover: true,
    logLevel: 'info',
    logFilePath: undefined,
    stateFilePath: 'desktop-memory-state',
    configPath: 'desktop-widget',
    thresholds: [],
    preferredRpcs: [
      {
        name: 'publicnode-ws',
        url: 'wss://ethereum-rpc.publicnode.com',
        transport: 'ws',
      },
    ],
    fallbackRpcs: [
      {
        name: 'publicnode-http',
        url: 'https://ethereum-rpc.publicnode.com',
        transport: 'http',
      },
      {
        name: '0xrpc-http',
        url: 'https://0xrpc.io/eth',
        transport: 'http',
      },
    ],
  }
}

function createUiLogger() {
  return {
    debug(message: string): void {
      void message
    },
    info(message: string): void {
      state.connectionStatus = message
      render()
    },
    warn(message: string): void {
      state.connectionStatus = message
      render()
      console.warn(message)
    },
    error(message: string): void {
      state.connectionStatus = message
      render()
      console.error(message)
    },
  }
}

function formatAge(timestampMs: number): string {
  const diffSeconds = Math.max(0, Math.round((Date.now() - timestampMs) / 1000))
  return `${String(diffSeconds).padStart(2, '0')}s ago`
}

function loadTheme(): ThemeMode {
  return localStorage.getItem(STORAGE_KEYS.theme) === 'plain' ? 'plain' : 'playful'
}

function loadRowCount(): RowCount {
  const stored = Number(localStorage.getItem(STORAGE_KEYS.rowCount))
  return stored === 2 || stored === 4 ? stored : 3
}

function nextRowCount(value: RowCount): RowCount {
  if (value === 2) {
    return 3
  }
  if (value === 3) {
    return 4
  }
  return 2
}
