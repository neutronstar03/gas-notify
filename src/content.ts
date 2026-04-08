/* global chrome */

import cssText from './content.css?inline'

const STORAGE_POSITION_KEY = 'gas-notify-overlay-position'
const OVERLAY_ID = 'gas-notify-root'
const STYLE_ID = 'gas-notify-style'
const TRAILING_ZERO_GWEI_PATTERN = /(?:\.0+|(?<=\.\d)0+)$/

const RPC_CONFIG = {
  wsProviders: [
    { name: 'publicnode-ws', url: 'wss://ethereum-rpc.publicnode.com' },
  ],
  httpProviders: [
    { name: 'publicnode-http', url: 'https://ethereum-rpc.publicnode.com' },
    { name: '0xrpc-http', url: 'https://0xrpc.io/eth' },
  ],
  timeoutMs: 12000,
  httpPollIntervalMs: 12000,
  reconnectBaseDelayMs: 2000,
  reconnectMaxDelayMs: 30000,
}

interface Observation {
  baseFeeGwei: number
  blockNumber: bigint
  timestampMs: number
  providerName: string
  mode: 'ws' | 'http'
}

class GasOverlayController {
  private root: HTMLDivElement | null = null
  private widget: HTMLElement | null = null
  private rowsEl: HTMLElement | null = null
  private statusEl: HTMLElement | null = null
  private dotEl: HTMLElement | null = null
  private footerEl: HTMLElement | null = null
  private monitor: GasMonitor | null = null
  private recent: Observation[] = []
  private dragState: { offsetX: number, offsetY: number } | null = null
  private ageTimer: number | null = null

  private readonly boundPointerMove = (event: PointerEvent) => this.onPointerMove(event)
  private readonly boundPointerUp = () => this.onPointerUp()

  async toggle(): Promise<void> {
    if (this.root) {
      this.hide()
      return
    }

    await this.show()
  }

  private async show(): Promise<void> {
    if (this.root) {
      return
    }

    ensureStyleTag()

    this.root = document.createElement('div')
    this.root.id = OVERLAY_ID
    this.root.innerHTML = `
      <section class="gas-notify-widget">
        <header class="gas-notify-widget__dragbar">
          <div class="gas-notify-widget__title">
            <span class="gas-notify-widget__badge">⛽</span>
            <div class="gas-notify-widget__copy">
              <strong>Gas Notify</strong>
              <span id="gas-notify-status">Connecting…</span>
            </div>
          </div>
          <span id="gas-notify-dot" class="gas-notify-widget__status-dot" data-mode="down"></span>
        </header>
        <div id="gas-notify-rows" class="gas-notify-widget__rows"></div>
        <footer id="gas-notify-footer" class="gas-notify-widget__footer">Waiting for first block…</footer>
      </section>
    `

    document.documentElement.append(this.root)

    this.widget = this.root.querySelector('.gas-notify-widget')
    this.rowsEl = this.root.querySelector('#gas-notify-rows')
    this.statusEl = this.root.querySelector('#gas-notify-status')
    this.dotEl = this.root.querySelector('#gas-notify-dot')
    this.footerEl = this.root.querySelector('#gas-notify-footer')

    await this.restorePosition()
    this.attachDragging()
    this.render()

    this.monitor = new GasMonitor({
      onObservation: (observation) => {
        this.recent = [observation, ...this.recent.filter(item => item.blockNumber !== observation.blockNumber)].slice(0, 3)
        this.setStatus(
          observation.mode === 'ws' ? `Live via ${observation.providerName}` : `HTTP via ${observation.providerName}`,
          observation.mode,
        )
        this.render()
      },
      onStatus: (message, mode = 'down') => {
        this.setStatus(message, mode)
      },
    })

    this.monitor.start()
    this.ageTimer = window.setInterval(() => this.renderFooter(), 1000)
  }

  private hide(): void {
    this.monitor?.stop()
    this.monitor = null

    if (this.ageTimer) {
      window.clearInterval(this.ageTimer)
      this.ageTimer = null
    }

    document.removeEventListener('pointermove', this.boundPointerMove)
    document.removeEventListener('pointerup', this.boundPointerUp)

    this.root?.remove()
    this.root = null
    this.widget = null
    this.rowsEl = null
    this.statusEl = null
    this.dotEl = null
    this.footerEl = null
    this.dragState = null
    this.recent = []
  }

  private setStatus(message: string, mode: 'ws' | 'http' | 'down'): void {
    if (this.statusEl) {
      this.statusEl.textContent = message
    }

    if (this.dotEl) {
      this.dotEl.dataset.mode = mode
    }
  }

  private render(): void {
    if (!this.rowsEl) {
      return
    }

    if (this.recent.length === 0) {
      this.rowsEl.innerHTML = '<div class="gas-notify-widget__empty">No gas data yet.</div>'
      this.renderFooter()
      return
    }

    this.rowsEl.innerHTML = this.recent.map((item, index) => `
      <article class="gas-notify-widget__row${index === 0 ? ' gas-notify-widget__row--latest' : ''}">
        <span class="gas-notify-widget__block">x${item.blockNumber.toString().slice(-4).padStart(4, '0')}</span>
        <strong class="gas-notify-widget__fee">${formatGwei(item.baseFeeGwei)} gwei</strong>
        <span class="gas-notify-widget__age">${formatAge(item.timestampMs)}</span>
      </article>
    `).join('')

    this.renderFooter()
  }

  private renderFooter(): void {
    if (!this.footerEl) {
      return
    }

    const latest = this.recent[0]
    this.footerEl.textContent = latest
      ? `Last update ${formatAge(latest.timestampMs)} · ${latest.providerName}`
      : 'Waiting for first block…'
  }

  private attachDragging(): void {
    const dragBar = this.root?.querySelector<HTMLElement>('.gas-notify-widget__dragbar')
    dragBar?.addEventListener('pointerdown', (rawEvent) => {
      const event = rawEvent as PointerEvent
      if (!this.widget || event.button !== 0) {
        return
      }

      event.preventDefault()

      const rect = this.widget.getBoundingClientRect()
      this.dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      }

      this.widget.classList.add('gas-notify-widget--dragging')
      document.addEventListener('pointermove', this.boundPointerMove)
      document.addEventListener('pointerup', this.boundPointerUp)
    })
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.widget || !this.dragState) {
      return
    }

    const maxLeft = Math.max(0, window.innerWidth - this.widget.offsetWidth)
    const maxTop = Math.max(0, window.innerHeight - this.widget.offsetHeight)
    const left = clamp(event.clientX - this.dragState.offsetX, 0, maxLeft)
    const top = clamp(event.clientY - this.dragState.offsetY, 0, maxTop)

    this.widget.style.left = `${left}px`
    this.widget.style.top = `${top}px`
    this.widget.style.right = 'auto'
  }

  private onPointerUp(): void {
    if (!this.widget) {
      return
    }

    this.widget.classList.remove('gas-notify-widget--dragging')
    document.removeEventListener('pointermove', this.boundPointerMove)
    document.removeEventListener('pointerup', this.boundPointerUp)

    void chrome.storage.local.set({
      [STORAGE_POSITION_KEY]: {
        left: this.widget.style.left,
        top: this.widget.style.top,
      },
    })

    this.dragState = null
  }

  private async restorePosition(): Promise<void> {
    if (!this.widget) {
      return
    }

    const stored = await chrome.storage.local.get(STORAGE_POSITION_KEY)
    const position = stored[STORAGE_POSITION_KEY] as { left?: string, top?: string } | undefined
    if (!position?.left || !position?.top) {
      return
    }

    this.widget.style.left = position.left
    this.widget.style.top = position.top
    this.widget.style.right = 'auto'
  }
}

class GasMonitor {
  private stopRequested = false
  private activeSocket: WebSocket | null = null

  constructor(
    private readonly handlers: {
      onObservation: (observation: Observation) => void
      onStatus: (message: string, mode?: 'ws' | 'http' | 'down') => void
    },
  ) {}

  start(): void {
    this.stopRequested = false
    void this.run()
  }

  stop(): void {
    this.stopRequested = true
    this.activeSocket?.close()
    this.activeSocket = null
  }

  private async run(): Promise<void> {
    let wsIndex = 0
    let httpIndex = 0
    let wsDelay = RPC_CONFIG.reconnectBaseDelayMs

    while (!this.stopRequested) {
      const wsProvider = RPC_CONFIG.wsProviders[wsIndex]
      if (wsProvider) {
        const ok = await this.runWebSocketProvider(wsProvider)
        if (this.stopRequested) {
          return
        }
        if (!ok && RPC_CONFIG.wsProviders.length > 0) {
          wsIndex = (wsIndex + 1) % RPC_CONFIG.wsProviders.length
          await sleep(wsDelay)
          wsDelay = Math.min(wsDelay * 2, RPC_CONFIG.reconnectMaxDelayMs)
        }
      }

      const httpProvider = RPC_CONFIG.httpProviders[httpIndex]
      if (!httpProvider) {
        this.handlers.onStatus('No HTTP fallback configured', 'down')
        await sleep(RPC_CONFIG.httpPollIntervalMs)
        continue
      }

      const shouldRetryWs = await this.runHttpFallback(httpProvider)
      if (this.stopRequested) {
        return
      }

      if (!shouldRetryWs && RPC_CONFIG.httpProviders.length > 0) {
        httpIndex = (httpIndex + 1) % RPC_CONFIG.httpProviders.length
      }

      wsDelay = RPC_CONFIG.reconnectBaseDelayMs
    }
  }

  private async runWebSocketProvider(provider: { name: string, url: string }): Promise<boolean> {
    this.handlers.onStatus(`Connecting to ${provider.name}`, 'down')

    try {
      const socket = new WebSocket(provider.url)
      this.activeSocket = socket
      let requestId = 1
      const pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()

      const sendRequest = (method: string, params: unknown[]) => new Promise<unknown>((resolve, reject) => {
        const id = requestId++
        const timer = window.setTimeout(() => {
          pending.delete(id)
          reject(new Error(`WebSocket RPC timeout for ${method}`))
        }, RPC_CONFIG.timeoutMs)

        pending.set(id, {
          resolve: (value) => {
            window.clearTimeout(timer)
            resolve(value)
          },
          reject: (error) => {
            window.clearTimeout(timer)
            reject(error)
          },
        })

        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      })

      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('WebSocket open timeout')), RPC_CONFIG.timeoutMs)
        socket.onopen = () => {
          window.clearTimeout(timer)
          resolve()
        }
        socket.onerror = () => {
          window.clearTimeout(timer)
          reject(new Error('WebSocket connection failed'))
        }
      })

      const subscriptionId = await sendRequest('eth_subscribe', ['newHeads'])
      this.handlers.onStatus(`Live via ${provider.name}`, 'ws')

      await new Promise<void>((resolve, reject) => {
        socket.onmessage = async (event) => {
          try {
            const payload = JSON.parse(String(event.data)) as {
              id?: number
              error?: { message: string }
              result?: unknown
              method?: string
              params?: { subscription?: unknown, result?: { number?: string } }
            }

            if (payload.id !== undefined) {
              const waiter = pending.get(payload.id)
              if (!waiter) {
                return
              }

              pending.delete(payload.id)
              if (payload.error) {
                waiter.reject(new Error(payload.error.message))
                return
              }
              waiter.resolve(payload.result)
              return
            }

            const isHead = payload.method === 'eth_subscription' && payload.params?.subscription === subscriptionId
            if (!isHead) {
              return
            }

            const blockTag = payload.params?.result?.number ?? 'latest'
            const block = await sendRequest('eth_getBlockByNumber', [blockTag, false])
            this.handlers.onObservation(toObservation(block, provider, 'ws'))
          }
          catch (error) {
            reject(ensureError(error))
          }
        }

        socket.onerror = () => reject(new Error('WebSocket stream failed'))
        socket.onclose = () => resolve()
      })

      return false
    }
    catch (error) {
      if (!this.stopRequested) {
        this.handlers.onStatus(`WS failed: ${ensureError(error).message}`, 'down')
      }
      return false
    }
    finally {
      this.activeSocket?.close()
      this.activeSocket = null
    }
  }

  private async runHttpFallback(provider: { name: string, url: string }): Promise<boolean> {
    this.handlers.onStatus(`HTTP fallback via ${provider.name}`, 'http')

    try {
      const block = await requestHttp(provider.url, 'eth_getBlockByNumber', ['latest', false])
      this.handlers.onObservation(toObservation(block, provider, 'http'))
    }
    catch (error) {
      this.handlers.onStatus(`HTTP failed: ${ensureError(error).message}`, 'down')
      return false
    }

    await sleep(RPC_CONFIG.httpPollIntervalMs)
    return true
  }
}

function ensureStyleTag(): void {
  if (document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = cssText
  document.documentElement.append(style)
}

async function requestHttp(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(RPC_CONFIG.timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  const payload = await response.json() as { error?: { message: string }, result?: unknown }
  if (payload.error) {
    throw new Error(payload.error.message)
  }

  return payload.result
}

function toObservation(block: unknown, provider: { name: string }, mode: 'ws' | 'http'): Observation {
  const cast = block as { baseFeePerGas?: string, number?: string, timestamp?: string }
  if (!cast?.baseFeePerGas || !cast?.number) {
    throw new Error('Block payload missing base fee')
  }

  return {
    baseFeeGwei: Number(BigInt(cast.baseFeePerGas)) / 1e9,
    blockNumber: BigInt(cast.number),
    timestampMs: cast.timestamp ? Number(BigInt(cast.timestamp)) * 1000 : Date.now(),
    providerName: provider.name,
    mode,
  }
}

function formatGwei(value: number): string {
  return value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3).replace(TRAILING_ZERO_GWEI_PATTERN, '')
}

function formatAge(timestampMs: number): string {
  const diffSeconds = Math.max(0, Math.round((Date.now() - timestampMs) / 1000))
  return `${String(diffSeconds).padStart(2, '0')}s`
}

function ensureError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const controller = new GasOverlayController()

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'gas-notify/toggle-overlay') {
    void controller.toggle()
  }
})
